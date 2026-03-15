const CRDTText = require("../crdt/text")
const OperationBuffer = require("./operation-buffer")
const OperationQueue = require("./operation-queue")

class DocumentService {
  constructor(storage, options = {}){
    // Support both old API (enableBatching boolean) and new API (options object)
    if (typeof options === 'boolean') {
      options = { enableBatching: options }
    }

    const {
      enableBatching = true,
      useAsyncQueue = true,  // Default: use async operation queue for better performance
      queueOptions = {}
    } = options

    this.storage = storage
    this.docs = new Map()
    this.operationCounts = new Map() // Track op count in memory to avoid DB queries

    // Choose between sync buffer or async queue
    if (useAsyncQueue) {
      this.buffer = new OperationQueue(storage, queueOptions)
      this.isAsync = true
    } else if (enableBatching) {
      this.buffer = new OperationBuffer(storage)
      this.isAsync = false
    } else {
      this.buffer = null
      this.isAsync = false
    }
  }

  loadDocument(docId){
    if(this.docs.has(docId)) return this.docs.get(docId)
    let crdt = new CRDTText()

    // Check for snapshot first
    const snapshot = this.storage.loadLatestSnapshot(docId)
    if (snapshot) {
      // Try to deserialize CRDT from snapshot (new format: serialized JSON)
      try {
        crdt = CRDTText.deserialize(snapshot.content)
      } catch (e) {
        // Fallback: old text-only snapshot format - rebuild CRDT from text
        crdt = this._buildCRDTFromText(snapshot.content)
      }

      // Apply only operations that occurred after the snapshot
      const recentOps = this.storage.loadOperationsSinceSnapshot(docId, snapshot.created_at)
      for (const r of recentOps) {
        this._applyStoredOperation(crdt, r)
      }
    } else {
      // No snapshot: load all operations
      const ops = this.storage.loadOperations(docId)
      for (const r of ops) {
        this._applyStoredOperation(crdt, r)
      }
    }

    this.docs.set(docId, crdt)
    return crdt
  }

  /**
   * Build CRDT from plain text (new snapshot format)
   */
  _buildCRDTFromText(text) {
    const crdt = new CRDTText()
    let afterId = 'ROOT'

    for (let i = 0; i < text.length; i++) {
      const id = `snapshot:${i}:${Date.now()}`
      crdt.insert(text[i], afterId, id)
      afterId = id
    }

    return crdt
  }

  /**
   * Apply a stored operation to CRDT, expanding batched operations
   */
  _applyStoredOperation(crdt, r) {
    const attrs = r.attrs ? JSON.parse(r.attrs) : null
    if (r.type === "insert") {
      crdt.insert(r.value, r.after_id, r.op_id, attrs)
    } else if (r.type === "delete") {
      crdt.delete(r.op_id)
    } else if (r.type === "format") {
      if (attrs) crdt.format(r.op_id, attrs)
    } else if (r.type === "insert_batch") {
      // Expand batched inserts
      const ids = r.op_id.split(',')
      const values = Array.from(r.value)  // Use Array.from to handle multi-byte unicode correctly
      let afterId = r.after_id

      for (let i = 0; i < values.length; i++) {
        crdt.insert(values[i], afterId, ids[i])
        afterId = ids[i] // Next insert comes after this one
      }
    } else if (r.type === "delete_batch") {
      // Expand batched deletes
      const ids = r.op_id.split(',')
      for (const id of ids) {
        crdt.delete(id)
      }
    } else if (r.type === "format_batch") {
      // Expand batched formats
      const ids = r.op_id.split(',')
      for (const id of ids) {
        if (attrs) crdt.format(id, attrs)
      }
    }
  }

  applyOperation(docId, op){
    const doc = this.loadDocument(docId)
    if(op.type==="insert") doc.insert(op.value, op.after, op.id, op.attrs)
    if(op.type==="delete") doc.delete(op.id)
    if(op.type==="format") doc.format(op.id, op.attrs)
    this.storage.saveOperation(docId, op)

    // Increment operation counter (for snapshot threshold tracking)
    this.operationCounts.set(docId, (this.operationCounts.get(docId) || 0) + 1)
  }

  /**
   * Apply operation with batching support
   * @param {string} docId - Document ID
   * @param {object} op - CRDT operation
   * @param {string} clientId - Client who initiated the operation
   * @param {number} offsetBeforeOp - Offset before operation (for deletes)
   * @returns {number} - Actual offset where operation occurred
   */
  applyOperationWithBatching(docId, op, clientId, offsetBeforeOp = null){
    const doc = this.loadDocument(docId)

    // For deletes, calculate offset before deletion
    let actualOffset = offsetBeforeOp
    if(op.type==="delete" && actualOffset === null) {
      actualOffset = doc.getOffsetOfId(op.id)
    }

    // Apply to CRDT immediately (for real-time UI)
    if(op.type==="insert") {
      doc.insert(op.value, op.after, op.id, op.attrs)
      // For inserts, get offset after insertion
      actualOffset = doc.getOffsetOfId(op.id)
    }
    if(op.type==="delete") {
      doc.delete(op.id)
    }
    if(op.type==="format") {
      doc.format(op.id, op.attrs)
    }

    // Add to buffer/queue or save directly
    if (this.buffer) {
      if (this.isAsync) {
        // Async queue - returns immediately, DB write happens in background
        this.buffer.enqueue(docId, op, clientId, actualOffset)
      } else {
        // Sync buffer - adds to buffer with timeout
        this.buffer.addOperation(docId, op, clientId, actualOffset)
      }
    } else {
      // No batching - write directly to DB
      this.storage.saveOperation(docId, op)
    }

    // Increment operation counter
    this.operationCounts.set(docId, (this.operationCounts.get(docId) || 0) + 1)

    return actualOffset
  }

  getText(docId){
    return this.loadDocument(docId).getText()
  }

  getFormattedChars(docId){
    return this.loadDocument(docId).getFormattedChars()
  }

  getCRDT(docId){
    return this.loadDocument(docId)
  }

  /**
   * Apply a format operation to a range of characters
   * @param {string} docId - Document ID
   * @param {string[]} charIds - IDs of characters to format
   * @param {object} attrs - Attributes to apply
   * @param {string} clientId - Client who initiated the operation
   */
  applyFormatWithBatching(docId, charIds, attrs, clientId){
    const doc = this.loadDocument(docId)

    // Apply to CRDT immediately
    for(const charId of charIds){
      doc.format(charId, attrs)
    }

    // Save as format operations
    for(const charId of charIds){
      const op = {type: "format", id: charId, attrs}
      if (this.buffer) {
        if (this.isAsync) {
          this.buffer.enqueue(docId, op, clientId)
        } else {
          this.buffer.addOperation(docId, op, clientId)
        }
      } else {
        this.storage.saveOperation(docId, op)
      }
    }

    this.operationCounts.set(docId, (this.operationCounts.get(docId) || 0) + charIds.length)
  }

  /**
   * Create snapshot of document and archive old operations
   */
  async createSnapshot(docId){
    const doc = this.loadDocument(docId)

    // Flush buffer first
    if (this.buffer) {
      if (this.isAsync) {
        await this.buffer.flush(docId)
      } else {
        this.buffer.flush(docId)
      }
    }

    // Compact CRDT to remove tombstones before serialization
    const compactResult = doc.compact()
    if (compactResult.removed > 0) {
      console.log(`[Snapshot] Compacted ${docId}: removed ${compactResult.removed} tombstones (${compactResult.compressionRatio}% reduction)`)
    }

    // Store serialized CRDT state (preserves full structure for correct reload)
    const serialized = doc.serialize()
    const timestamp = Date.now()

    // Save snapshot
    this.storage.saveSnapshot(docId, serialized, timestamp)

    // Archive old operations that are now captured in the snapshot
    this.storage.deleteOldOperations(docId, timestamp)

    // Reset operation counter
    this.operationCounts.set(docId, 0)

    const opCount = this.storage.getOperationCount(docId)
    const text = doc.getText()
    console.log(`[Snapshot] Created for ${docId}: ${text.length} chars, ${opCount} ops remaining`)
  }

  /**
   * Check if document needs snapshot (every N operations)
   */
  shouldCreateSnapshot(docId, operationThreshold = 100){
    const opCount = this.operationCounts.get(docId) || 0
    return opCount >= operationThreshold
  }

  /**
   * Flush all operation buffers/queues
   */
  async flushBuffers(){
    if (this.buffer) {
      if (this.isAsync) {
        await this.buffer.flushAll()
      } else {
        this.buffer.flushAll()
      }
    }
  }

  /**
   * Flush buffer/queue for specific document
   */
  async flushBuffer(docId){
    if (this.buffer) {
      if (this.isAsync) {
        await this.buffer.flush(docId)
      } else {
        this.buffer.flush(docId)
      }
    }
  }

  /**
   * Get operation queue statistics (for async mode)
   */
  getQueueStats(){
    if (this.buffer && this.isAsync) {
      return this.buffer.getStats()
    }
    return null
  }
}

module.exports = DocumentService
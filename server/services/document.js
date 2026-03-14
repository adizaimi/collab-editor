const CRDTText = require("../crdt/text")
const OperationBuffer = require("./operation-buffer")

class DocumentService {
  constructor(storage, enableBatching = true){
    this.storage = storage
    this.docs = new Map()
    this.buffer = enableBatching ? new OperationBuffer(storage) : null
  }

  loadDocument(docId){
    if(this.docs.has(docId)) return this.docs.get(docId)
    let crdt

    // Check for snapshot first
    const snapshot = this.storage.loadLatestSnapshot(docId)
    if (snapshot) {
      // Deserialize CRDT from snapshot
      crdt = CRDTText.deserialize(snapshot.content)

      // Load and apply operations since snapshot
      const recentOps = this.storage.loadOperationsSinceSnapshot(docId, snapshot.created_at)
      for (const r of recentOps) {
        this._applyStoredOperation(crdt, r)
      }
    } else {
      // Create new CRDT and load all operations
      crdt = new CRDTText()
      const ops = this.storage.loadOperations(docId)
      for (const r of ops) {
        this._applyStoredOperation(crdt, r)
      }
    }

    this.docs.set(docId, crdt)
    return crdt
  }

  /**
   * Apply a stored operation to CRDT, expanding batched operations
   */
  _applyStoredOperation(crdt, r) {
    if (r.type === "insert") {
      crdt.insert(r.value, r.after_id, r.op_id)
    } else if (r.type === "delete") {
      crdt.delete(r.op_id)
    } else if (r.type === "insert_batch") {
      // Expand batched inserts
      const ids = r.op_id.split(',')
      const values = r.value.split('')
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
    }
  }

  /**
   * Expand snapshot content into individual insert operations
   */
  _expandSnapshotToOperations(content) {
    const ops = []
    let afterId = 'ROOT'

    for (let i = 0; i < content.length; i++) {
      const id = `snapshot:${i}`
      ops.push({
        type: 'insert',
        id: id,
        value: content[i],
        after: afterId
      })
      afterId = id
    }

    return ops
  }

  applyOperation(docId, op){
    const doc = this.loadDocument(docId)
    if(op.type==="insert") doc.insert(op.value, op.after, op.id)
    if(op.type==="delete") doc.delete(op.id)
    this.storage.saveOperation(docId, op)
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

    // Apply to CRDT
    if(op.type==="insert") {
      doc.insert(op.value, op.after, op.id)
      // For inserts, get offset after insertion
      actualOffset = doc.getOffsetOfId(op.id)
    }
    if(op.type==="delete") {
      doc.delete(op.id)
    }

    // Add to buffer or save directly
    if (this.buffer) {
      this.buffer.addOperation(docId, op, clientId, actualOffset)
    } else {
      this.storage.saveOperation(docId, op)
    }

    return actualOffset
  }

  getText(docId){
    return this.loadDocument(docId).getText()
  }

  getCRDT(docId){
    return this.loadDocument(docId)
  }

  /**
   * Create snapshot of document and archive old operations
   */
  createSnapshot(docId){
    const doc = this.loadDocument(docId)

    // Flush buffer first
    if (this.buffer) {
      this.buffer.flush(docId)
    }

    // Serialize full CRDT state (not just text)
    const serialized = doc.serialize()

    // Save snapshot
    this.storage.saveSnapshot(docId, serialized)

    // Delete operations older than or equal to this snapshot
    const snapshot = this.storage.loadLatestSnapshot(docId)
    if (snapshot) {
      this.storage.deleteOldOperations(docId, snapshot.created_at)
    }
  }

  /**
   * Check if document needs snapshot (every N operations)
   */
  shouldCreateSnapshot(docId, operationThreshold = 100){
    const opCount = this.storage.getOperationCount(docId)
    return opCount >= operationThreshold
  }

  /**
   * Flush all operation buffers
   */
  flushBuffers(){
    if (this.buffer) {
      this.buffer.flushAll()
    }
  }

  /**
   * Flush buffer for specific document
   */
  flushBuffer(docId){
    if (this.buffer) {
      this.buffer.flush(docId)
    }
  }
}

module.exports = DocumentService
/**
 * OperationBuffer - Batches consecutive operations to reduce database writes
 *
 * Strategy:
 * - Buffer operations in memory
 * - Detect consecutive operations from same client
 * - Merge consecutive inserts: insert('a',0) + insert('b',1) -> insert('ab',0)
 * - Merge consecutive deletes: delete(id1) + delete(id2) -> delete([id1,id2])
 * - Flush on: timeout, pattern break, or manual trigger
 */

class OperationBuffer {
  constructor(storage, flushTimeout = 500) {
    this.storage = storage
    this.flushTimeout = flushTimeout
    this.buffers = new Map() // docId -> buffer state
  }

  /**
   * Add an operation to the buffer
   * @param {string} docId - Document ID
   * @param {object} op - CRDT operation {type, id, value, after}
   * @param {string} clientId - Client who initiated the operation
   * @param {number} actualOffset - Actual offset where operation occurred (post-CRDT-application)
   */
  addOperation(docId, op, clientId, actualOffset) {
    if (!this.buffers.has(docId)) {
      this.buffers.set(docId, {
        ops: [],
        clientId: null,
        type: null,
        timer: null,
        lastOffset: null
      })
    }

    const buffer = this.buffers.get(docId)

    // Check if this operation can be merged with buffer
    const canMerge = this._canMerge(buffer, op, clientId, actualOffset)

    if (!canMerge) {
      // Flush existing buffer and start new one
      this._flushBuffer(docId)
      buffer.ops = []
    }

    // Add operation to buffer with actual offset
    buffer.ops.push({ ...op, offset: actualOffset })
    buffer.clientId = clientId
    buffer.type = op.type
    buffer.lastOffset = actualOffset

    // Reset flush timer
    if (buffer.timer) {
      clearTimeout(buffer.timer)
    }
    buffer.timer = setTimeout(() => {
      this._flushBuffer(docId)
    }, this.flushTimeout)

    return true
  }

  /**
   * Check if operation can be merged with current buffer
   */
  _canMerge(buffer, op, clientId, actualOffset) {
    // Empty buffer - can always add
    if (buffer.ops.length === 0) {
      return true
    }

    // Different client - cannot merge
    if (buffer.clientId !== clientId) {
      return false
    }

    // Different operation type - cannot merge
    if (buffer.type !== op.type) {
      return false
    }

    // Check if operations are consecutive
    if (op.type === 'insert') {
      // For inserts: each new insert should be at next position
      // Last insert was at offset N, next should be at N+1
      const expectedOffset = buffer.lastOffset + 1
      return actualOffset === expectedOffset
    } else if (op.type === 'delete') {
      // For deletes we have two patterns:
      // - Delete key: offset stays same (3,3,3) - deleting forward
      // - Backspace: offset decreases (3,2,1) - deleting backward
      const isSameOffset = actualOffset === buffer.lastOffset
      const isBackspace = actualOffset === buffer.lastOffset - 1
      return isSameOffset || isBackspace
    }

    return false
  }

  /**
   * Flush buffer to storage
   */
  _flushBuffer(docId) {
    const buffer = this.buffers.get(docId)
    if (!buffer || buffer.ops.length === 0) {
      return
    }

    if (buffer.timer) {
      clearTimeout(buffer.timer)
      buffer.timer = null
    }

    // If single operation, save as-is
    if (buffer.ops.length === 1) {
      this.storage.saveOperation(docId, buffer.ops[0])
      buffer.ops = []
      return
    }

    // Batch multiple operations
    if (buffer.type === 'insert') {
      this._flushInsertBatch(docId, buffer.ops)
    } else if (buffer.type === 'delete') {
      this._flushDeleteBatch(docId, buffer.ops)
    }

    buffer.ops = []
  }

  /**
   * Flush batched insert operations
   * Combines: insert('a',0) + insert('b',1) + insert('c',2) -> insert('abc',0)
   */
  _flushInsertBatch(docId, ops) {
    const combinedValue = ops.map(op => op.value).join('')
    const firstOp = ops[0]
    const opIds = ops.map(op => op.id).join(',')

    const batchedOp = {
      type: 'insert_batch',
      id: opIds,
      value: combinedValue,
      after: firstOp.after,
      count: ops.length
    }

    this.storage.saveOperation(docId, batchedOp)
  }

  /**
   * Flush batched delete operations
   * Combines: delete(id1) + delete(id2) + delete(id3) -> delete([id1,id2,id3])
   */
  _flushDeleteBatch(docId, ops) {
    const opIds = ops.map(op => op.id).join(',')

    const batchedOp = {
      type: 'delete_batch',
      id: opIds,
      count: ops.length
    }

    this.storage.saveOperation(docId, batchedOp)
  }

  /**
   * Flush all buffers (called on server shutdown or manual trigger)
   */
  flushAll() {
    for (const docId of this.buffers.keys()) {
      this._flushBuffer(docId)
    }
  }

  /**
   * Flush specific document buffer
   */
  flush(docId) {
    this._flushBuffer(docId)
  }
}

module.exports = OperationBuffer

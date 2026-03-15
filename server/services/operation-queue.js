/**
 * OperationQueue - Asynchronous operation queue for better burst handling
 *
 * Architecture:
 * - Operations are queued in memory (per document)
 * - CRDT is updated immediately (for real-time UI)
 * - DB writes happen asynchronously in background
 * - Operations are batched for efficiency
 * - Maintains order within each document
 *
 * Benefits:
 * - Decouples UI updates from DB writes
 * - Handles burst writes gracefully
 * - Non-blocking operation processing
 * - Better throughput under load
 */

class OperationQueue {
  constructor(storage, options = {}) {
    this.storage = storage
    this.flushInterval = options.flushInterval || 500  // Flush every 500ms
    this.maxBatchSize = options.maxBatchSize || 100    // Max ops per batch
    this.maxQueueSize = options.maxQueueSize || 1000   // Max ops per document

    // Per-document queues
    this.queues = new Map()  // docId -> {ops: [], processing: false, timer: null}

    // Statistics
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalBatches: 0,
      errors: 0
    }

    // Start background processor
    this._startBackgroundProcessor()
  }

  /**
   * Queue an operation for async processing
   * @param {string} docId - Document ID
   * @param {object} op - CRDT operation
   * @param {string} clientId - Client who initiated the operation
   * @param {number} actualOffset - Actual offset where operation occurred
   * @returns {boolean} - True if queued, false if queue full
   */
  async enqueue(docId, op, clientId, actualOffset) {
    if (!this.queues.has(docId)) {
      this.queues.set(docId, {
        ops: [],
        processing: false,
        timer: null,
        lastFlush: Date.now()
      })
    }

    const queue = this.queues.get(docId)

    // Check queue size limit
    if (queue.ops.length >= this.maxQueueSize) {
      console.warn(`[OperationQueue] Queue full for ${docId}, flushing immediately`)
      await this._processQueue(docId)
    }

    // Add operation to queue with metadata
    queue.ops.push({
      op,
      clientId,
      actualOffset,
      queuedAt: Date.now()
    })

    this.stats.totalQueued++

    // Set flush timer if not already set
    if (!queue.timer) {
      queue.timer = setTimeout(() => {
        this._processQueue(docId)
      }, this.flushInterval)
    }

    return true
  }

  /**
   * Process queued operations for a document
   */
  async _processQueue(docId) {
    const queue = this.queues.get(docId)
    if (!queue || queue.ops.length === 0) {
      return
    }

    // Clear timer
    if (queue.timer) {
      clearTimeout(queue.timer)
      queue.timer = null
    }

    // Prevent concurrent processing
    if (queue.processing) {
      return
    }

    queue.processing = true

    try {
      // Take all queued operations
      const allOps = queue.ops.splice(0)

      if (allOps.length === 0) {
        return
      }

      // Process in batches of maxBatchSize
      for (let start = 0; start < allOps.length; start += this.maxBatchSize) {
        const opsToProcess = allOps.slice(start, start + this.maxBatchSize)

        // Group by client and operation type for batching
        const batches = this._createBatches(opsToProcess)

        // Collect all DB operations to save in a single transaction
        const dbOps = []
        const batchItems = [] // track which queue items each dbOp covers
        for (const batch of batches) {
          if (batch.ops.length === 1) {
            dbOps.push(batch.ops[0].op)
          } else {
            dbOps.push(this._createBatchedOp(batch))
          }
          batchItems.push(batch.ops)
        }

        try {
          // Write all operations in a single transaction
          if (dbOps.length === 1) {
            this.storage.saveOperation(docId, dbOps[0])
          } else if (this.storage.saveOperationBatch) {
            this.storage.saveOperationBatch(docId, dbOps)
          } else {
            // Fallback: save operations individually
            for (const op of dbOps) {
              this.storage.saveOperation(docId, op)
            }
          }

          const totalOps = batchItems.reduce((sum, items) => sum + items.length, 0)
          this.stats.totalProcessed += totalOps
          this.stats.totalBatches += batches.length
        } catch (error) {
          console.error(`[OperationQueue] Error processing batch for ${docId}:`, error)
          this.stats.errors++

          // Re-queue failed operations at front (but only once — they'll be retried on next flush)
          const allItems = batchItems.flat()
          queue.ops.unshift(...allItems)
          break  // Stop processing this batch — retry on next flush cycle
        }
      }

      queue.lastFlush = Date.now()

      // If more operations were added while processing, schedule another flush
      if (queue.ops.length > 0 && !queue.timer) {
        queue.timer = setTimeout(() => {
          this._processQueue(docId)
        }, this.flushInterval)
      }

    } finally {
      queue.processing = false
    }
  }

  /**
   * Group operations into batches for efficient storage
   */
  _createBatches(opsToProcess) {
    const batches = []
    let currentBatch = null

    for (const item of opsToProcess) {
      const { op, clientId, actualOffset } = item

      // Check if can add to current batch
      if (currentBatch && this._canBatch(currentBatch, op, clientId, actualOffset)) {
        currentBatch.ops.push(item)
        currentBatch.lastOffset = actualOffset  // Update lastOffset for next comparison
      } else {
        // Start new batch
        if (currentBatch) {
          batches.push(currentBatch)
        }
        currentBatch = {
          type: op.type,
          clientId,
          ops: [item],
          lastOffset: actualOffset
        }
      }
    }

    // Add final batch
    if (currentBatch) {
      batches.push(currentBatch)
    }

    return batches
  }

  /**
   * Check if operation can be batched with current batch
   */
  _canBatch(batch, op, clientId, actualOffset) {
    // Different client - cannot batch
    if (batch.clientId !== clientId) {
      return false
    }

    // Different operation type - cannot batch
    if (batch.type !== op.type) {
      return false
    }

    // Check if operations are consecutive
    if (op.type === 'insert') {
      // For inserts: each new insert should be at next position
      const expectedOffset = batch.lastOffset + 1
      return actualOffset === expectedOffset
    } else if (op.type === 'delete') {
      // For deletes: same offset (delete key) or decreasing (backspace)
      const isSameOffset = actualOffset === batch.lastOffset
      const isBackspace = actualOffset === batch.lastOffset - 1
      return isSameOffset || isBackspace
    } else if (op.type === 'format') {
      // Format ops with same attrs can be batched together
      const lastOp = batch.ops[batch.ops.length - 1].op
      return JSON.stringify(lastOp.attrs) === JSON.stringify(op.attrs)
    }

    return false
  }

  /**
   * Create a batched operation object from a batch of consecutive ops
   */
  _createBatchedOp(batch) {
    if (batch.type === 'insert') {
      return {
        type: 'insert_batch',
        id: batch.ops.map(item => item.op.id).join(','),
        value: batch.ops.map(item => item.op.value).join(''),
        after: batch.ops[0].op.after,
        count: batch.ops.length
      }
    } else if (batch.type === 'delete') {
      return {
        type: 'delete_batch',
        id: batch.ops.map(item => item.op.id).join(','),
        count: batch.ops.length
      }
    } else if (batch.type === 'format') {
      return {
        type: 'format_batch',
        id: batch.ops.map(item => item.op.id).join(','),
        attrs: batch.ops[0].op.attrs,
        count: batch.ops.length
      }
    }
    return batch.ops[0].op
  }

  /**
   * Background processor - flushes stale queues
   */
  _startBackgroundProcessor() {
    this._backgroundInterval = setInterval(() => {
      const now = Date.now()
      const staleThreshold = this.flushInterval * 2

      for (const [docId, queue] of this.queues.entries()) {
        // Flush if queue has operations and hasn't been flushed recently
        if (queue.ops.length > 0 &&
            !queue.processing &&
            (now - queue.lastFlush) > staleThreshold) {
          this._processQueue(docId)
        }
      }
    }, this.flushInterval)
  }

  /**
   * Flush all queues (for graceful shutdown)
   */
  async flushAll() {
    console.log('[OperationQueue] Flushing all queues...')

    const flushPromises = []
    for (const docId of this.queues.keys()) {
      flushPromises.push(this._processQueue(docId))
    }

    await Promise.all(flushPromises)

    console.log(`[OperationQueue] Flushed all queues. Stats:`, this.stats)
  }

  /**
   * Flush specific document queue
   */
  async flush(docId) {
    await this._processQueue(docId)
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const queueLengths = {}
    for (const [docId, queue] of this.queues.entries()) {
      queueLengths[docId] = queue.ops.length
    }

    return {
      ...this.stats,
      activeQueues: this.queues.size,
      queueLengths,
      totalQueued: this.stats.totalQueued,
      totalProcessed: this.stats.totalProcessed,
      pending: this.stats.totalQueued - this.stats.totalProcessed
    }
  }

  /**
   * Clean up inactive queues
   */
  cleanupInactive() {
    let cleanedCount = 0
    const now = Date.now()
    const inactiveThreshold = 60 * 60 * 1000  // 1 hour

    for (const [docId, queue] of this.queues.entries()) {
      if (queue.ops.length === 0 &&
          !queue.processing &&
          (now - queue.lastFlush) > inactiveThreshold) {
        if (queue.timer) {
          clearTimeout(queue.timer)
        }
        this.queues.delete(docId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`[OperationQueue] Cleaned up ${cleanedCount} inactive queues`)
    }

    return cleanedCount
  }

  /**
   * Stop the background processor and clear all timers
   */
  stop() {
    if (this._backgroundInterval) {
      clearInterval(this._backgroundInterval)
      this._backgroundInterval = null
    }
    for (const [, queue] of this.queues.entries()) {
      if (queue.timer) {
        clearTimeout(queue.timer)
        queue.timer = null
      }
    }
  }

  /**
   * Get queue length for a document
   */
  getQueueLength(docId) {
    const queue = this.queues.get(docId)
    return queue ? queue.ops.length : 0
  }
}

module.exports = OperationQueue

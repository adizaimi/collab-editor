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
      // Process all queued operations in batches
      while (queue.ops.length > 0) {
        // Take operations from queue (up to maxBatchSize)
        const opsToProcess = queue.ops.splice(0, this.maxBatchSize)

        if (opsToProcess.length === 0) {
          break
        }

        // Group by client and operation type for batching
        const batches = this._createBatches(opsToProcess)

        // Process each batch
        for (const batch of batches) {
          try {
            if (batch.ops.length === 1) {
              // Single operation - save directly
              await this._saveOperation(docId, batch.ops[0].op)
            } else {
              // Multiple operations - create batch
              await this._saveBatch(docId, batch)
            }

            this.stats.totalProcessed += batch.ops.length
            this.stats.totalBatches++
          } catch (error) {
            console.error(`[OperationQueue] Error processing batch for ${docId}:`, error)
            this.stats.errors++

            // Re-queue failed operations
            queue.ops.unshift(...batch.ops)
          }
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
    }

    return false
  }

  /**
   * Save single operation to storage
   */
  async _saveOperation(docId, op) {
    return new Promise((resolve, reject) => {
      try {
        this.storage.saveOperation(docId, op)
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Save batched operations to storage
   */
  async _saveBatch(docId, batch) {
    return new Promise((resolve, reject) => {
      try {
        if (batch.type === 'insert') {
          // Create insert batch
          const combinedValue = batch.ops.map(item => item.op.value).join('')
          const opIds = batch.ops.map(item => item.op.id).join(',')
          const firstOp = batch.ops[0].op

          const batchedOp = {
            type: 'insert_batch',
            id: opIds,
            value: combinedValue,
            after: firstOp.after,
            count: batch.ops.length
          }

          this.storage.saveOperation(docId, batchedOp)
        } else if (batch.type === 'delete') {
          // Create delete batch
          const opIds = batch.ops.map(item => item.op.id).join(',')

          const batchedOp = {
            type: 'delete_batch',
            id: opIds,
            count: batch.ops.length
          }

          this.storage.saveOperation(docId, batchedOp)
        }

        resolve()
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Background processor - flushes stale queues
   */
  _startBackgroundProcessor() {
    setInterval(() => {
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
   * Get queue length for a document
   */
  getQueueLength(docId) {
    const queue = this.queues.get(docId)
    return queue ? queue.ops.length : 0
  }
}

module.exports = OperationQueue

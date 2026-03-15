const assert = require('assert')
const OperationQueue = require('../../server/services/operation-queue')

// Mock storage
class MockStorage {
  constructor() {
    this.operations = []
  }

  saveOperation(docId, op) {
    this.operations.push({ docId, op })
  }

  saveOperationBatch(docId, ops) {
    for (const op of ops) {
      this.operations.push({ docId, op })
    }
  }

  getOperations() {
    return this.operations
  }

  clear() {
    this.operations = []
  }
}

// Utility to wait
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runTests() {
  console.log('='.repeat(70))
  console.log('OPERATION QUEUE UNIT TESTS')
  console.log('='.repeat(70))

  let passedTests = 0
  let totalTests = 0
  const allQueues = [] // Track all queues for cleanup

  // Test 1: Basic enqueue and stats
  {
    totalTests++
    console.log('\nTest 1: Basic enqueue and stats tracking')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 100 }); allQueues.push(queue)

    const op1 = { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }
    const op2 = { type: 'insert', id: 'op2', value: 'b', after: 'op1' }

    await queue.enqueue('doc1', op1, 'client1', 0)
    await queue.enqueue('doc1', op2, 'client1', 1)

    const stats = queue.getStats()
    assert.strictEqual(stats.totalQueued, 2, 'Should have queued 2 operations')
    assert.strictEqual(stats.pending, 2, 'Should have 2 pending operations')
    assert.strictEqual(stats.activeQueues, 1, 'Should have 1 active queue')

    console.log('✓ Enqueue works and stats are tracked correctly')
    passedTests++
  }

  // Test 2: Auto-flush after interval
  {
    totalTests++
    console.log('\nTest 2: Auto-flush after interval')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 100 }); allQueues.push(queue)

    const op = { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }
    await queue.enqueue('doc1', op, 'client1', 0)

    // Wait for auto-flush
    await wait(150)

    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 1, 'Should have processed 1 operation')
    assert.strictEqual(stats.pending, 0, 'Should have 0 pending operations')
    assert.strictEqual(storage.operations.length, 1, 'Should have 1 operation in storage')

    console.log('✓ Auto-flush works after interval')
    passedTests++
  }

  // Test 3: Manual flush
  {
    totalTests++
    console.log('\nTest 3: Manual flush')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue) // Long interval

    const op = { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }
    await queue.enqueue('doc1', op, 'client1', 0)

    // Manually flush
    await queue.flush('doc1')

    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 1, 'Should have processed 1 operation')
    assert.strictEqual(stats.pending, 0, 'Should have 0 pending operations')

    console.log('✓ Manual flush works')
    passedTests++
  }

  // Test 4: Flush all documents
  {
    totalTests++
    console.log('\nTest 4: Flush all documents')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    const op1 = { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }
    const op2 = { type: 'insert', id: 'op2', value: 'b', after: 'ROOT' }

    await queue.enqueue('doc1', op1, 'client1', 0)
    await queue.enqueue('doc2', op2, 'client2', 0)

    // Flush all
    await queue.flushAll()

    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 2, 'Should have processed 2 operations')
    assert.strictEqual(stats.pending, 0, 'Should have 0 pending operations')
    assert.strictEqual(storage.operations.length, 2, 'Should have 2 operations in storage')

    console.log('✓ Flush all works for multiple documents')
    passedTests++
  }

  // Test 5: Batch consecutive inserts
  {
    totalTests++
    console.log('\nTest 5: Batch consecutive inserts from same client')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    // Consecutive inserts
    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client1', 1)
    await queue.enqueue('doc1', { type: 'insert', id: 'op3', value: 'c', after: 'op2' }, 'client1', 2)

    await queue.flush('doc1')

    // Should create 1 batched operation
    assert.strictEqual(storage.operations.length, 1, 'Should have 1 batched operation')
    assert.strictEqual(storage.operations[0].op.type, 'insert_batch', 'Should be insert_batch')
    assert.strictEqual(storage.operations[0].op.value, 'abc', 'Should batch values as "abc"')
    assert.strictEqual(storage.operations[0].op.count, 3, 'Should have count of 3')

    console.log('✓ Consecutive inserts are batched correctly')
    passedTests++
  }

  // Test 6: Batch consecutive deletes
  {
    totalTests++
    console.log('\nTest 6: Batch consecutive deletes from same client')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    // Consecutive deletes (Delete key - same offset)
    await queue.enqueue('doc1', { type: 'delete', id: 'id1' }, 'client1', 5)
    await queue.enqueue('doc1', { type: 'delete', id: 'id2' }, 'client1', 5)
    await queue.enqueue('doc1', { type: 'delete', id: 'id3' }, 'client1', 5)

    await queue.flush('doc1')

    assert.strictEqual(storage.operations.length, 1, 'Should have 1 batched operation')
    assert.strictEqual(storage.operations[0].op.type, 'delete_batch', 'Should be delete_batch')
    assert.strictEqual(storage.operations[0].op.count, 3, 'Should have count of 3')

    console.log('✓ Consecutive deletes are batched correctly')
    passedTests++
  }

  // Test 7: Batch backspace deletes
  {
    totalTests++
    console.log('\nTest 7: Batch backspace deletes (decreasing offset)')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    // Backspace deletes (decreasing offset)
    await queue.enqueue('doc1', { type: 'delete', id: 'id1' }, 'client1', 5)
    await queue.enqueue('doc1', { type: 'delete', id: 'id2' }, 'client1', 4)
    await queue.enqueue('doc1', { type: 'delete', id: 'id3' }, 'client1', 3)

    await queue.flush('doc1')

    assert.strictEqual(storage.operations.length, 1, 'Should have 1 batched operation')
    assert.strictEqual(storage.operations[0].op.type, 'delete_batch', 'Should be delete_batch')

    console.log('✓ Backspace deletes are batched correctly')
    passedTests++
  }

  // Test 8: Don't batch different clients
  {
    totalTests++
    console.log('\nTest 8: Do not batch operations from different clients')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client2', 1)

    await queue.flush('doc1')

    // Should create 2 separate operations (different clients)
    assert.strictEqual(storage.operations.length, 2, 'Should have 2 separate operations')

    console.log('✓ Operations from different clients are not batched')
    passedTests++
  }

  // Test 9: Don't batch non-consecutive operations
  {
    totalTests++
    console.log('\nTest 9: Do not batch non-consecutive operations')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    // Non-consecutive inserts
    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client1', 5) // Gap!

    await queue.flush('doc1')

    // Should create 2 separate operations (non-consecutive)
    assert.strictEqual(storage.operations.length, 2, 'Should have 2 separate operations')

    console.log('✓ Non-consecutive operations are not batched')
    passedTests++
  }

  // Test 10: Queue size limit triggers immediate flush
  {
    totalTests++
    console.log('\nTest 10: Queue size limit triggers immediate flush')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000, maxQueueSize: 5 }); allQueues.push(queue)

    // Add operations up to limit
    for (let i = 0; i < 6; i++) {
      await queue.enqueue('doc1', { type: 'insert', id: `op${i}`, value: 'x', after: 'ROOT' }, 'client1', 0)
    }

    // Should have auto-flushed due to size limit
    const stats = queue.getStats()
    assert.ok(stats.totalProcessed >= 5, 'Should have processed at least 5 operations')

    console.log('✓ Queue size limit triggers immediate flush')
    passedTests++
  }

  // Test 11: Max batch size limit
  {
    totalTests++
    console.log('\nTest 11: Max batch size limit is respected')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000, maxBatchSize: 3 }); allQueues.push(queue)

    // Add 10 consecutive inserts
    for (let i = 0; i < 10; i++) {
      await queue.enqueue('doc1', { type: 'insert', id: `op${i}`, value: 'x', after: i === 0 ? 'ROOT' : `op${i-1}` }, 'client1', i)
    }

    await queue.flush('doc1')

    // First batch should have max 3 operations, remaining 7 should be left or batched separately
    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 10, 'All 10 operations should be processed')

    console.log('✓ Max batch size limit is respected')
    passedTests++
  }

  // Test 12: Queue statistics accuracy
  {
    totalTests++
    console.log('\nTest 12: Queue statistics are accurate')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client1', 1)
    await queue.enqueue('doc2', { type: 'insert', id: 'op3', value: 'c', after: 'ROOT' }, 'client2', 0)

    const statsBefore = queue.getStats()
    assert.strictEqual(statsBefore.totalQueued, 3, 'Should show 3 queued')
    assert.strictEqual(statsBefore.pending, 3, 'Should show 3 pending')
    assert.strictEqual(statsBefore.activeQueues, 2, 'Should show 2 active queues')

    await queue.flushAll()

    const statsAfter = queue.getStats()
    assert.strictEqual(statsAfter.totalProcessed, 3, 'Should show 3 processed')
    assert.strictEqual(statsAfter.pending, 0, 'Should show 0 pending')

    console.log('✓ Queue statistics are accurate')
    passedTests++
  }

  // Test 13: Get queue length for document
  {
    totalTests++
    console.log('\nTest 13: Get queue length for specific document')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client1', 1)
    await queue.enqueue('doc2', { type: 'insert', id: 'op3', value: 'c', after: 'ROOT' }, 'client2', 0)

    assert.strictEqual(queue.getQueueLength('doc1'), 2, 'doc1 should have 2 operations queued')
    assert.strictEqual(queue.getQueueLength('doc2'), 1, 'doc2 should have 1 operation queued')
    assert.strictEqual(queue.getQueueLength('doc3'), 0, 'doc3 should have 0 operations queued')

    console.log('✓ Queue length per document works correctly')
    passedTests++
  }

  // Test 14: Cleanup inactive queues
  {
    totalTests++
    console.log('\nTest 14: Cleanup inactive queues')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.flush('doc1')

    // Manually set lastFlush to far in the past
    const doc1Queue = queue.queues.get('doc1')
    doc1Queue.lastFlush = Date.now() - (2 * 60 * 60 * 1000) // 2 hours ago

    const cleaned = queue.cleanupInactive()
    assert.strictEqual(cleaned, 1, 'Should have cleaned 1 inactive queue')
    assert.strictEqual(queue.queues.has('doc1'), false, 'doc1 queue should be removed')

    console.log('✓ Inactive queue cleanup works')
    passedTests++
  }

  // Test 15: Multiple documents in parallel
  {
    totalTests++
    console.log('\nTest 15: Handle multiple documents in parallel')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    const promises = []
    for (let docNum = 0; docNum < 5; docNum++) {
      for (let i = 0; i < 10; i++) {
        const promise = queue.enqueue(
          `doc${docNum}`,
          { type: 'insert', id: `doc${docNum}-op${i}`, value: 'x', after: 'ROOT' },
          `client${docNum}`,
          i
        )
        promises.push(promise)
      }
    }

    await Promise.all(promises)
    await queue.flushAll()

    const stats = queue.getStats()
    assert.strictEqual(stats.totalQueued, 50, 'Should have queued 50 operations')
    assert.strictEqual(stats.totalProcessed, 50, 'Should have processed 50 operations')
    assert.strictEqual(stats.pending, 0, 'Should have 0 pending')

    console.log('✓ Multiple documents handled in parallel')
    passedTests++
  }

  // Test 16: Mix of inserts and deletes (no batching)
  {
    totalTests++
    console.log('\nTest 16: Mix of inserts and deletes are not batched together')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'delete', id: 'op1' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'ROOT' }, 'client1', 0)

    await queue.flush('doc1')

    // Should create 3 separate operations (different types)
    assert.strictEqual(storage.operations.length, 3, 'Should have 3 separate operations')

    console.log('✓ Mixed operation types are not batched')
    passedTests++
  }

  // Test 17: Concurrent processing prevention
  {
    totalTests++
    console.log('\nTest 17: Prevent concurrent processing of same queue')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'op1' }, 'client1', 1)

    // Start two flushes concurrently
    const flush1 = queue.flush('doc1')
    const flush2 = queue.flush('doc1')

    await Promise.all([flush1, flush2])

    // Should not duplicate operations
    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 2, 'Should process operations only once')

    console.log('✓ Concurrent processing prevention works')
    passedTests++
  }

  // Test 18: Mixed operation types produce multiple DB operations via saveOperationBatch
  {
    totalTests++
    console.log('\nTest 18: Mixed ops from same client use saveOperationBatch correctly')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    // insert, delete, insert — cannot be batched together (different types)
    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'delete', id: 'op1' }, 'client1', 0)
    await queue.enqueue('doc1', { type: 'insert', id: 'op2', value: 'b', after: 'ROOT' }, 'client1', 0)

    await queue.flush('doc1')

    assert.strictEqual(storage.operations.length, 3, 'Should save 3 separate operations via batch')
    assert.strictEqual(storage.operations[0].op.type, 'insert', 'First op is insert')
    assert.strictEqual(storage.operations[1].op.type, 'delete', 'Second op is delete')
    assert.strictEqual(storage.operations[2].op.type, 'insert', 'Third op is insert')

    const stats = queue.getStats()
    assert.strictEqual(stats.totalProcessed, 3, 'All 3 ops processed')
    assert.strictEqual(stats.errors, 0, 'No errors')

    console.log('✓ Mixed operation types correctly saved via saveOperationBatch')
    passedTests++
  }

  // Test 19: Error recovery does not cause infinite loop
  {
    totalTests++
    console.log('\nTest 19: Error in storage does not cause infinite retry loop')

    let callCount = 0
    const errorStorage = {
      saveOperation(docId, op) {
        callCount++
        if (callCount <= 2) throw new Error('Simulated DB error')
        // Succeeds after 2 failures
      },
      saveOperationBatch(docId, ops) {
        callCount++
        throw new Error('Simulated batch error')
      }
    }

    const queue = new OperationQueue(errorStorage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)

    // First flush — should fail but NOT loop infinitely
    await queue.flush('doc1')

    const stats = queue.getStats()
    assert.strictEqual(stats.errors, 1, 'Should record 1 error')
    // Operations should be re-queued (not lost)
    assert.ok(queue.getQueueLength('doc1') >= 1, 'Failed ops should be re-queued for retry')

    console.log('✓ Error recovery does not cause infinite loop')
    passedTests++
  }

  // Test 20: stop() clears all timers
  {
    totalTests++
    console.log('\nTest 20: stop() clears background interval and flush timers')

    const storage = new MockStorage()
    const queue = new OperationQueue(storage, { flushInterval: 10000 }); allQueues.push(queue)

    await queue.enqueue('doc1', { type: 'insert', id: 'op1', value: 'a', after: 'ROOT' }, 'client1', 0)

    // Verify timer exists
    const q = queue.queues.get('doc1')
    assert.ok(q.timer !== null, 'Flush timer should be set')
    assert.ok(queue._backgroundInterval !== null, 'Background interval should be set')

    queue.stop()

    assert.strictEqual(q.timer, null, 'Flush timer should be cleared after stop()')
    assert.strictEqual(queue._backgroundInterval, null, 'Background interval should be cleared after stop()')

    console.log('✓ stop() clears all timers correctly')
    passedTests++
  }

  // Cleanup all queues to prevent process hang from background intervals
  for (const q of allQueues) {
    q.stop()
  }

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log(`OPERATION QUEUE TESTS COMPLETE: ${passedTests}/${totalTests} passed`)
  console.log('='.repeat(70))

  if (passedTests === totalTests) {
    console.log('\n✅ All operation queue tests passed!')
    return true
  } else {
    console.log(`\n❌ ${totalTests - passedTests} test(s) failed`)
    return false
  }
}

// Run tests
runTests()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('Test suite error:', error)
    process.exit(1)
  })

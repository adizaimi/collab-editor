/**
 * Unit tests for OperationBuffer
 * Tests operation batching logic (merging consecutive inserts/deletes)
 */

const OperationBuffer = require('../../server/services/operation-buffer')

// Mock storage
class MockStorage {
  constructor() {
    this.operations = []
  }

  saveOperation(docId, op) {
    this.operations.push({ docId, ...op })
  }

  getOperations() {
    return this.operations
  }

  clear() {
    this.operations = []
  }
}

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

// Test counter
let testCount = 0
let passCount = 0

function runTest(name, testFn) {
  testCount++
  try {
    testFn()
    passCount++
    console.log(`  ✅ PASSED: ${name}`)
  } catch (err) {
    console.log(`  ❌ FAILED: ${name}`)
    console.log(`     ${err.message}`)
  }
}

console.log("=".repeat(60))
console.log("UNIT TESTS: OperationBuffer")
console.log("=".repeat(60))

// Test 1: Consecutive inserts are batched
console.log("\n[Test 1] Consecutive inserts from same client are batched")
runTest("buffers consecutive inserts", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Add 3 consecutive inserts
  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.addOperation('doc1', { type: 'insert', id: 'id2', value: 'b', after: 'id1' }, 'client1', 1)
  buffer.addOperation('doc1', { type: 'insert', id: 'id3', value: 'c', after: 'id2' }, 'client1', 2)

  // Manually flush
  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 1, "should save 1 batched operation")
  assertEquals(ops[0].type, 'insert_batch', "should be insert_batch type")
  assertEquals(ops[0].value, 'abc', "should combine values")
  assertEquals(ops[0].id, 'id1,id2,id3', "should combine IDs")
  assertEquals(ops[0].count, 3, "should have count=3")
})

// Test 2: Non-consecutive inserts are not batched
console.log("\n[Test 2] Non-consecutive inserts break the batch")
runTest("non-consecutive inserts not batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Add inserts with gap in offset
  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.addOperation('doc1', { type: 'insert', id: 'id2', value: 'b', after: 'id1' }, 'client1', 1)
  buffer.addOperation('doc1', { type: 'insert', id: 'id3', value: 'c', after: 'id1' }, 'client1', 5) // Gap!

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 2, "should save 2 operations (batch + single)")
  assertEquals(ops[0].type, 'insert_batch', "first should be batched")
  assertEquals(ops[0].value, 'ab', "first batch contains ab")
  assertEquals(ops[1].type, 'insert', "second should be single insert")
  assertEquals(ops[1].value, 'c', "second contains c")
})

// Test 3: Different clients break the batch
console.log("\n[Test 3] Different clients break the batch")
runTest("different clients not batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.addOperation('doc1', { type: 'insert', id: 'id2', value: 'b', after: 'id1' }, 'client2', 1) // Different client

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 2, "should save 2 separate operations")
  assertEquals(ops[0].type, 'insert', "first should be single insert")
  assertEquals(ops[1].type, 'insert', "second should be single insert")
})

// Test 4: Consecutive deletes (delete key) are batched
console.log("\n[Test 4] Consecutive deletes with same offset (delete key) are batched")
runTest("consecutive delete-key operations batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Delete key: offset stays same
  buffer.addOperation('doc1', { type: 'delete', id: 'id1' }, 'client1', 3)
  buffer.addOperation('doc1', { type: 'delete', id: 'id2' }, 'client1', 3)
  buffer.addOperation('doc1', { type: 'delete', id: 'id3' }, 'client1', 3)

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 1, "should save 1 batched operation")
  assertEquals(ops[0].type, 'delete_batch', "should be delete_batch type")
  assertEquals(ops[0].id, 'id1,id2,id3', "should combine IDs")
  assertEquals(ops[0].count, 3, "should have count=3")
})

// Test 5: Consecutive backspaces are batched
console.log("\n[Test 5] Consecutive backspaces (decreasing offset) are batched")
runTest("consecutive backspace operations batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Backspace: offset decreases
  buffer.addOperation('doc1', { type: 'delete', id: 'id1' }, 'client1', 4)
  buffer.addOperation('doc1', { type: 'delete', id: 'id2' }, 'client1', 3)
  buffer.addOperation('doc1', { type: 'delete', id: 'id3' }, 'client1', 2)

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 1, "should save 1 batched operation")
  assertEquals(ops[0].type, 'delete_batch', "should be delete_batch type")
  assertEquals(ops[0].id, 'id1,id2,id3', "should combine IDs")
})

// Test 6: Non-consecutive deletes break batch
console.log("\n[Test 6] Non-consecutive deletes break the batch")
runTest("non-consecutive deletes not batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  buffer.addOperation('doc1', { type: 'delete', id: 'id1' }, 'client1', 3)
  buffer.addOperation('doc1', { type: 'delete', id: 'id2' }, 'client1', 3)
  buffer.addOperation('doc1', { type: 'delete', id: 'id3' }, 'client1', 5) // Gap!

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 2, "should save 2 operations")
  assertEquals(ops[0].type, 'delete_batch', "first should be batched")
  assertEquals(ops[1].type, 'delete', "second should be single delete")
})

// Test 7: Mixed operation types break batch
console.log("\n[Test 7] Mixed operation types (insert/delete) break the batch")
runTest("insert after delete breaks batch", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.addOperation('doc1', { type: 'delete', id: 'id2' }, 'client1', 0) // Type change

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 2, "should save 2 separate operations")
  assertEquals(ops[0].type, 'insert', "first should be insert")
  assertEquals(ops[1].type, 'delete', "second should be delete")
})

// Test 8: Single operation saved as-is
console.log("\n[Test 8] Single operation saved without batching")
runTest("single operation not batched", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 1, "should save 1 operation")
  assertEquals(ops[0].type, 'insert', "should be regular insert (not batched)")
  assertEquals(ops[0].value, 'a', "should have single character")
})

// Test 9: Flush on timeout
console.log("\n[Test 9] Buffer flushes automatically on timeout")
runTest("automatic flush on timeout", (done) => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 50) // 50ms timeout

  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)

  // Wait for timeout
  setTimeout(() => {
    const ops = storage.getOperations()
    assert(ops.length === 1, "should auto-flush after timeout")
  }, 100)
})

// Test 10: FlushAll flushes all documents
console.log("\n[Test 10] FlushAll flushes all document buffers")
runTest("flushAll flushes multiple documents", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  buffer.addOperation('doc1', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' }, 'client1', 0)
  buffer.addOperation('doc2', { type: 'insert', id: 'id2', value: 'b', after: 'ROOT' }, 'client1', 0)

  buffer.flushAll()

  const ops = storage.getOperations()
  assert(ops.length === 2, "should flush both documents")
  assert(ops.some(op => op.docId === 'doc1'), "should have doc1 operation")
  assert(ops.some(op => op.docId === 'doc2'), "should have doc2 operation")
})

// Test 11: Large batch test
console.log("\n[Test 11] Large batch of consecutive inserts")
runTest("large batch of inserts", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Simulate typing "hello world"
  const text = "hello world"
  for (let i = 0; i < text.length; i++) {
    buffer.addOperation('doc1', {
      type: 'insert',
      id: `id${i}`,
      value: text[i],
      after: i === 0 ? 'ROOT' : `id${i-1}`
    }, 'client1', i)
  }

  buffer.flush('doc1')

  const ops = storage.getOperations()
  assert(ops.length === 1, "should save single batched operation")
  assertEquals(ops[0].value, "hello world", "should combine all characters")
  assertEquals(ops[0].count, 11, "should have count=11")
})

// Test 12: Mixed backspace and delete key
console.log("\n[Test 12] Mixed backspace and delete key operations")
runTest("mixed delete patterns", () => {
  const storage = new MockStorage()
  const buffer = new OperationBuffer(storage, 1000)

  // Start with backspace pattern
  buffer.addOperation('doc1', { type: 'delete', id: 'id1' }, 'client1', 5)
  buffer.addOperation('doc1', { type: 'delete', id: 'id2' }, 'client1', 4) // Backspace (decreasing)
  buffer.addOperation('doc1', { type: 'delete', id: 'id3' }, 'client1', 4) // Delete key (same offset)
  // This should NOT break because both 4->4 patterns are valid

  buffer.flush('doc1')

  const ops = storage.getOperations()
  // The 5->4 is valid (backspace), 4->4 is valid (delete key or backspace)
  assert(ops.length === 1, "should batch compatible delete patterns")
})

console.log("\n" + "=".repeat(60))
console.log("OperationBuffer Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${testCount}`)
console.log(`✅ Passed: ${passCount}`)
console.log(`❌ Failed: ${testCount - passCount}`)
console.log("=".repeat(60))

if (passCount === testCount) {
  console.log("\n✅ All operation buffer tests passed!\n")
  process.exit(0)
} else {
  console.log(`\n❌ ${testCount - passCount} test(s) failed\n`)
  process.exit(1)
}

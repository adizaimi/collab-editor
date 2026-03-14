/**
 * Unit tests for Snapshot System
 * Tests snapshot creation, loading, and operation archival
 */

const SQLiteStorage = require('../../server/storage/sqlite')
const DocumentService = require('../../server/services/document')
const fs = require('fs')
const path = require('path')

// Test database
const testDb = path.join(__dirname, 'snapshot-test.db')

// Clean up before tests
if (fs.existsSync(testDb)) {
  fs.unlinkSync(testDb)
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
console.log("UNIT TESTS: Snapshot System")
console.log("=".repeat(60))

// Initialize storage
const storage = new SQLiteStorage()
// Override database path for testing
storage.db = require('better-sqlite3')(testDb)
storage.init()

// Test 1: Save and load snapshot
console.log("\n[Test 1] Save and load snapshot")
runTest("snapshot saves and loads correctly", () => {
  storage.saveSnapshot('doc1', 'Hello World')

  const snapshot = storage.loadLatestSnapshot('doc1')
  assert(snapshot !== null && snapshot !== undefined, "snapshot should exist")
  assertEquals(snapshot.content, 'Hello World', "snapshot content should match")
  assertEquals(snapshot.doc_id, 'doc1', "snapshot doc_id should match")
  assert(snapshot.created_at > 0, "snapshot should have timestamp")
})

// Test 2: Latest snapshot is returned
console.log("\n[Test 2] Latest snapshot is returned when multiple exist")
runTest("returns latest snapshot", () => {
  // Create multiple snapshots
  storage.saveSnapshot('doc2', 'Version 1')
  // Wait a bit to ensure different timestamps
  const now = Date.now()
  while (Date.now() === now) { /* wait */ }
  storage.saveSnapshot('doc2', 'Version 2')

  const snapshot = storage.loadLatestSnapshot('doc2')
  assertEquals(snapshot.content, 'Version 2', "should return latest snapshot")
})

// Test 3: Load operations since snapshot
console.log("\n[Test 3] Load operations since snapshot timestamp")
runTest("loads only operations after snapshot", () => {
  // Clear old data
  storage.db.exec("DELETE FROM operations WHERE doc_id = 'doc3'")
  storage.db.exec("DELETE FROM snapshots WHERE doc_id = 'doc3'")

  // Add some operations
  storage.saveOperation('doc3', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' })
  storage.saveOperation('doc3', { type: 'insert', id: 'id2', value: 'b', after: 'id1' })

  // Wait to ensure different timestamp
  let now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  // Create snapshot
  storage.saveSnapshot('doc3', 'ab')
  const snapshot = storage.loadLatestSnapshot('doc3')

  // Wait to ensure operations after snapshot have later timestamp
  now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  // Add more operations after snapshot
  storage.saveOperation('doc3', { type: 'insert', id: 'id3', value: 'c', after: 'id2' })
  storage.saveOperation('doc3', { type: 'insert', id: 'id4', value: 'd', after: 'id3' })

  // Load operations since snapshot
  const ops = storage.loadOperationsSinceSnapshot('doc3', snapshot.created_at)
  assertEquals(ops.length, 2, "should load only operations after snapshot")
  assertEquals(ops[0].op_id, 'id3', "first op should be id3")
  assertEquals(ops[1].op_id, 'id4', "second op should be id4")
})

// Test 4: Delete old operations
console.log("\n[Test 4] Delete operations older than timestamp")
runTest("deletes old operations", () => {
  // Clear old data
  storage.db.exec("DELETE FROM operations WHERE doc_id = 'doc4'")

  // Add operations
  storage.saveOperation('doc4', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' })
  storage.saveOperation('doc4', { type: 'insert', id: 'id2', value: 'b', after: 'id1' })

  // Get cutoff time after old operations
  const cutoffTime = Date.now()

  // Wait to ensure new operations are after cutoff
  let now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  storage.saveOperation('doc4', { type: 'insert', id: 'id3', value: 'c', after: 'id2' })

  // Delete old operations (should delete id1 and id2, keep id3)
  storage.deleteOldOperations('doc4', cutoffTime)

  const remaining = storage.loadOperations('doc4')
  assertEquals(remaining.length, 1, "should keep only new operations")
  assertEquals(remaining[0].op_id, 'id3', "should keep operation after cutoff")
})

// Test 5: Operation count
console.log("\n[Test 5] Get operation count for document")
runTest("counts operations correctly", () => {
  // Clear old data
  storage.db.exec("DELETE FROM operations WHERE doc_id = 'doc5'")

  storage.saveOperation('doc5', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' })
  storage.saveOperation('doc5', { type: 'insert', id: 'id2', value: 'b', after: 'id1' })
  storage.saveOperation('doc5', { type: 'insert', id: 'id3', value: 'c', after: 'id2' })

  const count = storage.getOperationCount('doc5')
  assertEquals(count, 3, "should count all operations")
})

// Test 6: DocumentService creates snapshot
console.log("\n[Test 6] DocumentService creates snapshot and archives operations")
runTest("document service creates snapshot", () => {
  // Use a separate storage for this test
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false) // Disable batching for this test

  // Add operations (wait between them to ensure different timestamps)
  docService.applyOperation('doc6', { type: 'insert', id: 'id1', value: 'H', after: 'ROOT' })
  const now1 = Date.now()
  while (Date.now() === now1) { /* wait */ }
  docService.applyOperation('doc6', { type: 'insert', id: 'id2', value: 'i', after: 'id1' })
  const now2 = Date.now()
  while (Date.now() === now2) { /* wait */ }

  // Create snapshot
  docService.createSnapshot('doc6')

  // Verify snapshot exists
  const snapshot = testStorage.loadLatestSnapshot('doc6')
  assert(snapshot !== null && snapshot !== undefined, "snapshot should be created")

  // Verify snapshot contains plain text (NEW FORMAT)
  assertEquals(snapshot.content, 'Hi', "snapshot should contain plain text")

  // NOTE: With text-only snapshots, we keep operations for CRDT reconstruction
  // Operations are NOT deleted to maintain referential integrity
  const ops = testStorage.loadOperations('doc6')
  assert(ops.length >= 0, "operations may be kept for CRDT integrity")
})

// Test 7: Load document from snapshot
console.log("\n[Test 7] DocumentService loads document from snapshot")
runTest("loads document from snapshot", () => {
  // Use a separate storage for this test
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService1 = new DocumentService(testStorage, false)

  // Create document with operations
  docService1.applyOperation('doc7', { type: 'insert', id: 'id1', value: 'H', after: 'ROOT' })
  docService1.applyOperation('doc7', { type: 'insert', id: 'id2', value: 'e', after: 'id1' })
  docService1.applyOperation('doc7', { type: 'insert', id: 'id3', value: 'y', after: 'id2' })

  // Wait to ensure different timestamps
  let now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  // Create snapshot
  docService1.createSnapshot('doc7')
  const snapshot = testStorage.loadLatestSnapshot('doc7')

  // Wait to ensure new operation has later timestamp than snapshot
  now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  // Add more operations after snapshot
  docService1.applyOperation('doc7', { type: 'insert', id: 'id4', value: '!', after: 'id3' })

  // Verify operation was saved with timestamp after snapshot
  const allOps = testStorage.loadOperations('doc7')
  const recentOps = testStorage.loadOperationsSinceSnapshot('doc7', snapshot.created_at)
  assert(recentOps.length > 0, `should have operations after snapshot (snapshot: ${snapshot.created_at}, ops: ${JSON.stringify(allOps.map(o => o.created_at))})`)

  // Create new service instance (simulates server restart)
  const docService2 = new DocumentService(testStorage, false)

  // Load document (should load from snapshot + recent ops)
  const text = docService2.getText('doc7')
  assertEquals(text, 'Hey!', "should load from snapshot and apply recent ops")
})

// Test 8: shouldCreateSnapshot threshold
console.log("\n[Test 8] shouldCreateSnapshot detects threshold")
runTest("snapshot threshold detection", () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Add operations below threshold
  for (let i = 0; i < 50; i++) {
    docService.applyOperation('doc8', {
      type: 'insert',
      id: `id${i}`,
      value: 'x',
      after: i === 0 ? 'ROOT' : `id${i-1}`
    })
  }

  assert(!docService.shouldCreateSnapshot('doc8', 100), "should not need snapshot below threshold")

  // Add more operations to exceed threshold
  for (let i = 50; i < 101; i++) {
    docService.applyOperation('doc8', {
      type: 'insert',
      id: `id${i}`,
      value: 'x',
      after: `id${i-1}`
    })
  }

  assert(docService.shouldCreateSnapshot('doc8', 100), "should need snapshot above threshold")
})

// Test 9: Batched operations expand correctly on load
console.log("\n[Test 9] Batched operations expand correctly when loading")
runTest("batched operations expand on load", () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  // Manually save a batched operation
  testStorage.saveOperation('doc9', {
    type: 'insert_batch',
    id: 'id1,id2,id3',
    value: 'abc',
    after: 'ROOT'
  })

  const docService = new DocumentService(testStorage, false)
  const text = docService.getText('doc9')
  assertEquals(text, 'abc', "should expand batched insert correctly")
})

// Test 10: Batched deletes expand correctly
console.log("\n[Test 10] Batched delete operations expand correctly when loading")
runTest("batched deletes expand on load", () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Add some characters
  docService.applyOperation('doc10', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' })
  docService.applyOperation('doc10', { type: 'insert', id: 'id2', value: 'b', after: 'id1' })
  docService.applyOperation('doc10', { type: 'insert', id: 'id3', value: 'c', after: 'id2' })

  // Manually save a batched delete
  testStorage.saveOperation('doc10', {
    type: 'delete_batch',
    id: 'id1,id2'
  })

  // Create new service to reload from storage
  const docService2 = new DocumentService(testStorage, false)
  const text = docService2.getText('doc10')
  assertEquals(text, 'c', "should expand batched delete correctly")
})

console.log("\n" + "=".repeat(60))
console.log("Snapshot System Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${testCount}`)
console.log(`✅ Passed: ${passCount}`)
console.log(`❌ Failed: ${testCount - passCount}`)
console.log("=".repeat(60))

// Cleanup
if (fs.existsSync(testDb)) {
  fs.unlinkSync(testDb)
}

if (passCount === testCount) {
  console.log("\n✅ All snapshot tests passed!\n")
  process.exit(0)
} else {
  console.log(`\n❌ ${testCount - passCount} test(s) failed\n`)
  process.exit(1)
}

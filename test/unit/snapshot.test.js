/**
 * Unit tests for Snapshot System
 * Tests snapshot creation, loading, and operation archival
 */

const SQLiteStorage = require('../../server/storage/sqlite')
const DocumentService = require('../../server/services/document')
const CRDTText = require('../../server/crdt/text')
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
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// Test counter
let testCount = 0
let passCount = 0

async function runTest(name, testFn) {
  testCount++
  try {
    await testFn()
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

// Main async test runner
async function runAllTests() {

// Initialize storage
const storage = new SQLiteStorage()
// Override database path for testing
storage.db = require('better-sqlite3')(testDb)
storage.init()

// Test 1: Save and load snapshot
console.log("\n[Test 1] Save and load snapshot")
await runTest("snapshot saves and loads correctly", () => {
  storage.saveSnapshot('doc1', 'Hello World')

  const snapshot = storage.loadLatestSnapshot('doc1')
  assert(snapshot !== null && snapshot !== undefined, "snapshot should exist")
  assertEquals(snapshot.content, 'Hello World', "snapshot content should match")
  assertEquals(snapshot.doc_id, 'doc1', "snapshot doc_id should match")
  assert(snapshot.created_at > 0, "snapshot should have timestamp")
})

// Test 2: Latest snapshot is returned
console.log("\n[Test 2] Latest snapshot is returned when multiple exist")
await runTest("returns latest snapshot", () => {
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
await runTest("loads only operations after snapshot", () => {
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
await runTest("deletes old operations", () => {
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
await runTest("counts operations correctly", () => {
  // Clear old data
  storage.db.exec("DELETE FROM operations WHERE doc_id = 'doc5'")

  storage.saveOperation('doc5', { type: 'insert', id: 'id1', value: 'a', after: 'ROOT' })
  storage.saveOperation('doc5', { type: 'insert', id: 'id2', value: 'b', after: 'id1' })
  storage.saveOperation('doc5', { type: 'insert', id: 'id3', value: 'c', after: 'id2' })

  const count = storage.getOperationCount('doc5')
  assertEquals(count, 3, "should count all operations")
})

// Test 6: DocumentService creates snapshot with serialized CRDT
console.log("\n[Test 6] DocumentService creates snapshot with serialized CRDT and archives operations")
await runTest("document service creates snapshot and archives ops", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Add operations
  docService.applyOperation('doc6', { type: 'insert', id: 'id1', value: 'H', after: 'ROOT' })
  const now1 = Date.now()
  while (Date.now() === now1) { /* wait */ }
  docService.applyOperation('doc6', { type: 'insert', id: 'id2', value: 'i', after: 'id1' })
  const now2 = Date.now()
  while (Date.now() === now2) { /* wait */ }

  // Create snapshot
  await docService.createSnapshot('doc6')

  // Verify snapshot exists
  const snapshot = testStorage.loadLatestSnapshot('doc6')
  assert(snapshot !== null && snapshot !== undefined, "snapshot should be created")

  // Verify snapshot contains serialized CRDT (JSON)
  const parsed = JSON.parse(snapshot.content)
  assert(parsed.root === 'ROOT', "snapshot should contain serialized CRDT with root")
  assert(Array.isArray(parsed.chars), "snapshot should contain chars array")

  // Verify old operations were archived (deleted)
  const ops = testStorage.loadOperations('doc6')
  assertEquals(ops.length, 0, "old operations should be archived after snapshot")
})

// Test 7: Load document from snapshot
console.log("\n[Test 7] DocumentService loads document from snapshot")
await runTest("loads document from snapshot + recent ops", async () => {
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

  // Create snapshot (archives old ops)
  await docService1.createSnapshot('doc7')

  // Wait to ensure new operation has later timestamp than snapshot
  now = Date.now()
  while (Date.now() - now < 5) { /* wait 5ms */ }

  // After snapshot+compact, old IDs are replaced. Look up current ID at offset 2 (end of "Hey")
  const crdt7 = docService1.getCRDT('doc7')
  const afterId = crdt7.getIdAtOffset(2) // ID of 'y' in compacted CRDT

  // Add operation using current ID (simulates real server flow)
  docService1.applyOperation('doc7', { type: 'insert', id: 'id4', value: '!', after: afterId })

  // Create new service instance (simulates server restart)
  const docService2 = new DocumentService(testStorage, false)

  // Load document (should load from snapshot + recent ops)
  const text = docService2.getText('doc7')
  assertEquals(text, 'Hey!', "should load from snapshot and apply recent ops")
})

// Test 8: shouldCreateSnapshot threshold
console.log("\n[Test 8] shouldCreateSnapshot detects threshold")
await runTest("snapshot threshold detection", () => {
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
await runTest("batched operations expand on load", () => {
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
await runTest("batched deletes expand on load", () => {
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

// Test 11: Snapshot + archive cycle preserves document integrity
console.log("\n[Test 11] Snapshot archive cycle preserves document across multiple snapshots")
await runTest("multiple snapshot cycles preserve document", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Build document
  docService.applyOperation('doc11', { type: 'insert', id: 'a1', value: 'A', after: 'ROOT' })
  docService.applyOperation('doc11', { type: 'insert', id: 'b1', value: 'B', after: 'a1' })

  let now = Date.now()
  while (Date.now() - now < 5) {}

  // First snapshot
  await docService.createSnapshot('doc11')
  assertEquals(testStorage.getOperationCount('doc11'), 0, "ops should be archived after 1st snapshot")

  now = Date.now()
  while (Date.now() - now < 5) {}

  // After compact, look up current IDs
  const crdt11 = docService.getCRDT('doc11')
  const afterBId = crdt11.getIdAtOffset(1) // ID of 'B' in compacted CRDT
  const aId = crdt11.getIdAtOffset(0) // ID of 'A' in compacted CRDT

  // More edits using current IDs
  docService.applyOperation('doc11', { type: 'insert', id: 'c1', value: 'C', after: afterBId })
  docService.applyOperation('doc11', { type: 'delete', id: aId })

  now = Date.now()
  while (Date.now() - now < 5) {}

  // Second snapshot
  await docService.createSnapshot('doc11')
  assertEquals(testStorage.getOperationCount('doc11'), 0, "ops should be archived after 2nd snapshot")

  // Simulate restart
  const docService2 = new DocumentService(testStorage, false)
  const text = docService2.getText('doc11')
  assertEquals(text, 'BC', "document should be correct after multiple snapshot cycles")
})

// Test 12: CRDT serialize/deserialize roundtrip
console.log("\n[Test 13] CRDT serialize/deserialize roundtrip")
await runTest("CRDT roundtrip preserves text and structure", () => {
  const crdt = new CRDTText()
  crdt.insert('H', 'ROOT', 'id1')
  crdt.insert('e', 'id1', 'id2')
  crdt.insert('l', 'id2', 'id3')
  crdt.insert('l', 'id3', 'id4')
  crdt.insert('o', 'id4', 'id5')

  const serialized = crdt.serialize()
  const restored = CRDTText.deserialize(serialized)

  assertEquals(restored.getText(), 'Hello', "deserialized CRDT should produce same text")
  assertEquals(restored.chars.size, crdt.chars.size, "deserialized CRDT should have same char count")

  // Verify new operations work on deserialized CRDT
  restored.insert('!', 'id5', 'id6')
  assertEquals(restored.getText(), 'Hello!', "should be able to insert after deserialize")
})

// Test 14: CRDT serialize/deserialize preserves deletions
console.log("\n[Test 14] CRDT serialize/deserialize preserves deletions (tombstones)")
await runTest("CRDT roundtrip preserves tombstones", () => {
  const crdt = new CRDTText()
  crdt.insert('a', 'ROOT', 'id1')
  crdt.insert('b', 'id1', 'id2')
  crdt.insert('c', 'id2', 'id3')
  crdt.delete('id2') // delete 'b'

  const serialized = crdt.serialize()
  const restored = CRDTText.deserialize(serialized)

  assertEquals(restored.getText(), 'ac', "deserialized should reflect deletions")

  // Deleting same ID again should be safe (idempotent)
  restored.delete('id2')
  assertEquals(restored.getText(), 'ac', "double delete should be safe")
})

// Test 15: CRDT compact
console.log("\n[Test 15] CRDT compact removes tombstones")
await runTest("compact removes deleted nodes", () => {
  const crdt = new CRDTText()
  crdt.insert('a', 'ROOT', 'id1')
  crdt.insert('b', 'id1', 'id2')
  crdt.insert('c', 'id2', 'id3')
  crdt.delete('id2')

  const sizeBefore = crdt.chars.size
  const result = crdt.compact()

  assertEquals(crdt.getText(), 'ac', "text should be preserved after compact")
  assert(result.newSize < sizeBefore, "compacted CRDT should have fewer nodes")
  assert(result.removed > 0, "compact should remove at least one node")
})

// Test 16: Unicode emoji in batched operations expand correctly
console.log("\n[Test 16] Unicode emoji in batched insert operations")
await runTest("batched insert with emoji expands correctly", () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  // Save a batched op where one value is an emoji (multi-byte)
  testStorage.saveOperation('doc16', {
    type: 'insert_batch',
    id: 'id1,id2,id3',
    value: '😀AB',
    after: 'ROOT'
  })

  const docService = new DocumentService(testStorage, false)
  const text = docService.getText('doc16')
  assertEquals(text, '😀AB', "should correctly expand batched insert with emoji")
})

// Test 17: Snapshot without tombstones preserves IDs (no unnecessary compact)
console.log("\n[Test 17] Snapshot without tombstones preserves original IDs")
await runTest("snapshot without tombstones preserves IDs", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Build document (no deletions = no tombstones)
  docService.applyOperation('doc17', { type: 'insert', id: 'id1', value: 'X', after: 'ROOT' })
  docService.applyOperation('doc17', { type: 'insert', id: 'id2', value: 'Y', after: 'id1' })

  // Snapshot should NOT compact (no tombstones), preserving IDs
  await docService.createSnapshot('doc17')

  let now17 = Date.now()
  while (Date.now() - now17 < 5) { /* wait 5ms */ }

  const crdt = docService.getCRDT('doc17')
  // IDs should still exist because compact was skipped (no tombstones)
  assert(crdt.chars.has('id1'), "id1 should still exist (no tombstones to compact)")
  assert(crdt.chars.has('id2'), "id2 should still exist (no tombstones to compact)")

  // Operations using original IDs should still work
  docService.applyOperation('doc17', { type: 'insert', id: 'id3', value: 'Z', after: 'id2' })
  assertEquals(docService.getText('doc17'), 'XYZ', "insert with original ID works")

  // Simulate restart - verify persistence
  const docService2 = new DocumentService(testStorage, false)
  assertEquals(docService2.getText('doc17'), 'XYZ', "document correct after restart")
})

// Test 18: Snapshot WITH tombstones does compact and replaces IDs
console.log("\n[Test 18] Snapshot with tombstones compacts and replaces IDs")
await runTest("snapshot with tombstones compacts IDs", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  docService.applyOperation('doc18', { type: 'insert', id: 'id1', value: 'A', after: 'ROOT' })
  docService.applyOperation('doc18', { type: 'insert', id: 'id2', value: 'B', after: 'id1' })
  docService.applyOperation('doc18', { type: 'delete', id: 'id1' }) // creates tombstone

  await docService.createSnapshot('doc18')

  const crdt = docService.getCRDT('doc18')
  // Old IDs should be gone after compact (tombstones existed)
  assert(!crdt.chars.has('id1'), "old id1 should not exist after compact")
  assert(!crdt.chars.has('id2'), "old id2 should not exist after compact")

  // New IDs work via offset lookup
  const bId = crdt.getIdAtOffset(0)
  assert(bId !== 'ROOT', "should find compacted ID at offset 0")
  assertEquals(docService.getText('doc18'), 'B', "text correct after compact")

  // Simulate restart
  const docService2 = new DocumentService(testStorage, false)
  assertEquals(docService2.getText('doc18'), 'B', "document correct after restart")
})

// Test 19: Operations added after a tombstone-triggered compact survive restart
console.log("\n[Test 19] Post-compact operations persist correctly across restart")
await runTest("post-compact ops survive restart", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  // Build document with a deletion (creates tombstone → compact will run)
  docService.applyOperation('doc19', { type: 'insert', id: 'a', value: 'A', after: 'ROOT' })
  docService.applyOperation('doc19', { type: 'insert', id: 'b', value: 'B', after: 'a' })
  docService.applyOperation('doc19', { type: 'insert', id: 'c', value: 'C', after: 'b' })
  docService.applyOperation('doc19', { type: 'delete', id: 'b' }) // tombstone

  let now = Date.now()
  while (Date.now() - now < 5) {}

  // Snapshot triggers compact (tombstone exists), replacing all IDs
  await docService.createSnapshot('doc19')

  now = Date.now()
  while (Date.now() - now < 5) {}

  // Add new operations using compacted IDs
  const crdt19 = docService.getCRDT('doc19')
  const lastId = crdt19.getIdAtOffset(1) // 'C' in compacted CRDT
  docService.applyOperation('doc19', { type: 'insert', id: 'new1', value: 'D', after: lastId })
  docService.applyOperation('doc19', { type: 'insert', id: 'new2', value: 'E', after: 'new1' })
  assertEquals(docService.getText('doc19'), 'ACDE', "text correct before restart")

  // Simulate restart — loads snapshot + replays recent ops
  const docService2 = new DocumentService(testStorage, false)
  assertEquals(docService2.getText('doc19'), 'ACDE', "post-compact ops survive restart")
})

// Test 20: Consecutive snapshots without edits are idempotent
console.log("\n[Test 20] Consecutive snapshots without edits are idempotent")
await runTest("consecutive snapshots preserve document", async () => {
  const testStorage = new SQLiteStorage()
  testStorage.db = require('better-sqlite3')(':memory:')
  testStorage.init()

  const docService = new DocumentService(testStorage, false)

  docService.applyOperation('doc20', { type: 'insert', id: 'x1', value: 'H', after: 'ROOT' })
  docService.applyOperation('doc20', { type: 'insert', id: 'x2', value: 'i', after: 'x1' })

  let now = Date.now()
  while (Date.now() - now < 5) {}

  // Create multiple snapshots in a row (simulates the snapshot storm)
  await docService.createSnapshot('doc20')
  now = Date.now()
  while (Date.now() - now < 5) {}
  await docService.createSnapshot('doc20')
  now = Date.now()
  while (Date.now() - now < 5) {}
  await docService.createSnapshot('doc20')

  assertEquals(docService.getText('doc20'), 'Hi', "text intact after 3 consecutive snapshots")

  // IDs should be preserved (no tombstones → no compact)
  const crdt20 = docService.getCRDT('doc20')
  assert(crdt20.chars.has('x1'), "original IDs preserved through multiple snapshots")

  // Restart still works
  const docService2 = new DocumentService(testStorage, false)
  assertEquals(docService2.getText('doc20'), 'Hi', "document correct after restart")
})

// Test 21: compact() returns zero removal when no tombstones
console.log("\n[Test 21] compact() short-circuits with no tombstones")
await runTest("compact returns removed=0 without tombstones", () => {
  const crdt = new CRDTText()
  crdt.insert('a', 'ROOT', 'id1')
  crdt.insert('b', 'id1', 'id2')

  const result = crdt.compact()
  assertEquals(result.removed, 0, "should report 0 removed")
  assertEquals(result.oldSize, result.newSize, "sizes should match")
  assert(crdt.chars.has('id1'), "original id1 should still exist")
  assert(crdt.chars.has('id2'), "original id2 should still exist")
  assertEquals(crdt.getText(), 'ab', "text unchanged")
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

} // End of runAllTests

// Run all tests
runAllTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})

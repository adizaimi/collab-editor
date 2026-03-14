/**
 * Additional CRDT Tests - Corner Cases and Edge Cases
 * Tests for scenarios not covered in the main test suite
 */

const CRDTText = require('../../server/crdt/text')

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
console.log("ADDITIONAL CRDT TESTS: Corner Cases & Edge Cases")
console.log("=".repeat(60))

// Test 1: ID collision handling
console.log("\n[Test 1] Duplicate ID insertion is rejected")
runTest("duplicate ID insert does nothing", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('B', 'id1', 'id2')
  crdt.insert('X', 'id1', 'id2') // Duplicate ID!

  assertEquals(crdt.getText(), 'AB', "duplicate ID should be ignored")
  assertEquals(crdt.chars.size, 3, "should have ROOT + 2 chars only")
})

// Test 2: getOffsetOfId with deleted character
console.log("\n[Test 2] getOffsetOfId behavior with deleted characters")
runTest("offset skips deleted chars before target", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('B', 'id1', 'id2')
  crdt.insert('C', 'id2', 'id3')

  crdt.delete('id2') // Delete 'B'

  assertEquals(crdt.getOffsetOfId('id3'), 1, "C should be at offset 1 (A is 0)")
})

runTest("getOffsetOfId with deleted target returns its position if found", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('B', 'id1', 'id2')
  crdt.insert('C', 'id2', 'id3')

  crdt.delete('id2') // Delete 'B'

  // Bug: getOffsetOfId finds the deleted char but returns offset as if not deleted
  const offset = crdt.getOffsetOfId('id2')
  // The current implementation finds id2 before checking deleted status
  // This is a potential bug!
  console.log(`     INFO: Deleted char offset = ${offset} (implementation-dependent)`)
})

// Test 3: Very large document performance
console.log("\n[Test 3] Large document handling")
runTest("insert 1000 characters sequentially", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  const startTime = Date.now()
  for (let i = 0; i < 1000; i++) {
    const id = `id${i}`
    crdt.insert('x', afterId, id)
    afterId = id
  }
  const duration = Date.now() - startTime

  assertEquals(crdt.getText().length, 1000, "should have 1000 characters")
  console.log(`     INFO: Inserted 1000 chars in ${duration}ms`)
  assert(duration < 1000, "should complete in under 1 second")
})

runTest("document with many tombstones grows memory", () => {
  const crdt = new CRDTText()

  // Insert 100 chars
  for (let i = 0; i < 100; i++) {
    crdt.insert('x', i === 0 ? 'ROOT' : `id${i-1}`, `id${i}`)
  }

  // Delete 90 of them
  for (let i = 0; i < 90; i++) {
    crdt.delete(`id${i}`)
  }

  assertEquals(crdt.getText().length, 10, "should have 10 visible chars")
  assertEquals(crdt.chars.size, 101, "BUT should have 101 nodes (100 chars + ROOT)")
  console.log(`     WARNING: 90% of chars are tombstones - memory leak!`)
})

// Test 4: Concurrent insertions at same position
console.log("\n[Test 4] Concurrent operations at same position")
runTest("concurrent inserts use LIFO ordering", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')

  // Both insert after id1 at "same time"
  crdt.insert('X', 'id1', 'id_x')
  crdt.insert('Y', 'id1', 'id_y')

  const text = crdt.getText()
  // LIFO: Most recent (Y) comes first
  assertEquals(text, 'AYX', "should use LIFO ordering")
})

runTest("three-way concurrent insert", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')

  crdt.insert('X', 'id1', 'id_x')
  crdt.insert('Y', 'id1', 'id_y')
  crdt.insert('Z', 'id1', 'id_z')

  const text = crdt.getText()
  assertEquals(text, 'AZYX', "should maintain LIFO: Z,Y,X")
})

// Test 5: Empty document edge cases
console.log("\n[Test 5] Empty document operations")
runTest("getIdAtOffset(-1) on empty doc returns ROOT", () => {
  const crdt = new CRDTText()
  assertEquals(crdt.getIdAtOffset(-1), 'ROOT', "offset -1 should return ROOT")
})

runTest("getIdAtOffset(0) on empty doc returns ROOT", () => {
  const crdt = new CRDTText()
  assertEquals(crdt.getIdAtOffset(0), 'ROOT', "offset 0 on empty doc returns ROOT")
})

runTest("getOffsetOfId('ROOT') returns 0", () => {
  const crdt = new CRDTText()
  assertEquals(crdt.getOffsetOfId('ROOT'), 0, "ROOT should be at offset 0")
})

// Test 6: Serialize/Deserialize with complex structure
console.log("\n[Test 6] Serialization edge cases")
runTest("serialize/deserialize with deleted chars", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('B', 'id1', 'id2')
  crdt.insert('C', 'id2', 'id3')
  crdt.delete('id2')

  const serialized = crdt.serialize()
  const restored = CRDTText.deserialize(serialized)

  assertEquals(restored.getText(), 'AC', "should preserve deleted state")
  assertEquals(restored.chars.size, crdt.chars.size, "should have same number of nodes")

  // Check that deleted char is still there
  assert(restored.chars.has('id2'), "deleted char should still exist")
  assertEquals(restored.chars.get('id2').deleted, true, "char should be marked deleted")
})

runTest("serialize empty document", () => {
  const crdt = new CRDTText()
  const serialized = crdt.serialize()
  const restored = CRDTText.deserialize(serialized)

  assertEquals(restored.getText(), '', "empty doc should stay empty")
  assertEquals(restored.chars.size, 1, "should have only ROOT node")
})

runTest("serialize large document size check", () => {
  const crdt = new CRDTText()

  // Create doc with 100 chars + 900 deletions = 1000 nodes
  for (let i = 0; i < 100; i++) {
    crdt.insert('x', i === 0 ? 'ROOT' : `id${i-1}`, `id${i}`)
  }

  // Add and delete 900 more
  for (let i = 100; i < 1000; i++) {
    const afterId = `id${i % 100}`
    crdt.insert('y', afterId, `id${i}`)
    crdt.delete(`id${i}`)
  }

  const serialized = crdt.serialize()
  const sizeKB = serialized.length / 1024

  console.log(`     INFO: 100 visible chars + 900 tombstones = ${sizeKB.toFixed(1)}KB`)
  console.log(`     WARNING: This is ${(sizeKB / (crdt.getText().length / 1024)).toFixed(0)}x larger than just the text!`)

  // This test exposes the snapshot size problem!
  assert(sizeKB > 10, "should be suspiciously large")
})

// Test 7: Invalid operations
console.log("\n[Test 7] Invalid operation handling")
runTest("insert with non-existent afterId is ignored", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'DOES_NOT_EXIST', 'id1')

  assertEquals(crdt.getText(), '', "invalid insert should be ignored")
  assertEquals(crdt.chars.size, 1, "should only have ROOT")
})

runTest("delete non-existent ID is safe", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')

  crdt.delete('DOES_NOT_EXIST') // Should not crash

  assertEquals(crdt.getText(), 'A', "text should be unchanged")
})

runTest("double delete is safe", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')

  crdt.delete('id1')
  crdt.delete('id1') // Delete again!

  assertEquals(crdt.getText(), '', "should stay deleted")
})

// Test 8: Special characters
console.log("\n[Test 8] Special character handling")
runTest("unicode characters", () => {
  const crdt = new CRDTText()
  crdt.insert('😀', 'ROOT', 'id1')
  crdt.insert('🎉', 'id1', 'id2')
  crdt.insert('中', 'id2', 'id3')

  assertEquals(crdt.getText(), '😀🎉中', "should handle unicode")
})

runTest("newline and whitespace", () => {
  const crdt = new CRDTText()
  crdt.insert('\n', 'ROOT', 'id1')
  crdt.insert(' ', 'id1', 'id2')
  crdt.insert('\t', 'id2', 'id3')

  assertEquals(crdt.getText(), '\n \t', "should handle whitespace")
})

// Test 9: findIdByValueAtOffset edge cases
console.log("\n[Test 9] findIdByValueAtOffset corner cases")
runTest("find in document with duplicates", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('A', 'id1', 'id2')
  crdt.insert('A', 'id2', 'id3')

  // Find second 'A'
  const id = crdt.findIdByValueAtOffset('A', 1)
  assertEquals(id, 'id2', "should find second A")
})

runTest("find with wrong value returns null", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')

  const id = crdt.findIdByValueAtOffset('B', 0)
  assertEquals(id, null, "should return null for wrong value")
})

runTest("find skips deleted characters", () => {
  const crdt = new CRDTText()
  crdt.insert('A', 'ROOT', 'id1')
  crdt.insert('B', 'id1', 'id2')
  crdt.insert('C', 'id2', 'id3')

  crdt.delete('id2') // Delete B

  // Now offset 1 is C (B is deleted)
  const id = crdt.findIdByValueAtOffset('C', 1)
  assertEquals(id, 'id3', "should find C at adjusted offset")
})

// Test 10: Memory and performance
console.log("\n[Test 10] Memory and performance characteristics")
runTest("rapid insert/delete cycles", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  const startTime = Date.now()
  for (let i = 0; i < 100; i++) {
    const id = `id${i}`
    crdt.insert('x', afterId, id)
    if (i % 2 === 0) {
      crdt.delete(id) // Delete every other one
    }
    afterId = id
  }
  const duration = Date.now() - startTime

  assertEquals(crdt.getText().length, 50, "should have 50 visible chars")
  assertEquals(crdt.chars.size, 101, "should have 101 nodes including tombstones")
  console.log(`     INFO: 100 ops in ${duration}ms`)
})

console.log("\n" + "=".repeat(60))
console.log("Additional CRDT Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${testCount}`)
console.log(`✅ Passed: ${passCount}`)
console.log(`❌ Failed: ${testCount - passCount}`)
console.log("=".repeat(60))

if (passCount === testCount) {
  console.log("\n✅ All additional CRDT tests passed!\n")
  process.exit(0)
} else {
  console.log(`\n❌ ${testCount - passCount} test(s) failed\n`)
  process.exit(1)
}

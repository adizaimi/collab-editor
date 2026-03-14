/**
 * Large Document Test - Stack Overflow Prevention
 * Tests that the CRDT can handle very large documents without stack overflow
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

console.log("============================================================")
console.log("LARGE DOCUMENT TEST: Stack Overflow Prevention")
console.log("============================================================")

let testCount = 0
let passCount = 0

function runTest(name, testFn) {
  testCount++
  try {
    const startTime = Date.now()
    testFn()
    const duration = Date.now() - startTime
    passCount++
    console.log(`  ✅ PASSED: ${name} (${duration}ms)`)
  } catch (err) {
    console.log(`  ❌ FAILED: ${name}`)
    console.log(`     ${err.message}`)
  }
}

// Test 1: Very large document (10,000 characters)
console.log("\n[Test 1] Insert 10,000 characters sequentially (paste simulation)")
runTest("10,000 character sequential insert", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  // Simulate pasting a large document
  for (let i = 0; i < 10000; i++) {
    const char = String.fromCharCode(65 + (i % 26)) // A-Z repeated
    const id = `char-${i}`
    crdt.insert(char, afterId, id)
    afterId = id
  }

  const text = crdt.getText()
  assertEquals(text.length, 10000, "text should have 10,000 characters")
})

// Test 2: Large document with getText() - should not stack overflow
console.log("\n[Test 2] getText() on large document (no stack overflow)")
runTest("getText on 10,000 chars", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  for (let i = 0; i < 10000; i++) {
    crdt.insert('x', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  const text = crdt.getText()
  assertEquals(text.length, 10000, "should get all 10,000 characters")
  assertEquals(text, 'x'.repeat(10000), "all characters should be 'x'")
})

// Test 3: Large document with getVisibleChars() - should not stack overflow
console.log("\n[Test 3] getVisibleChars() on large document (no stack overflow)")
runTest("getVisibleChars on 10,000 chars", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  for (let i = 0; i < 10000; i++) {
    crdt.insert('a', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  const chars = crdt.getVisibleChars()
  assertEquals(chars.length, 10000, "should return 10,000 visible chars")
})

// Test 4: Large document with deletions - reproducing user's crash scenario
console.log("\n[Test 4] Large document with deletions at beginning (user's crash scenario)")
runTest("paste large doc then delete at start", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  // Simulate pasting 5,000 characters
  const ids = []
  for (let i = 0; i < 5000; i++) {
    const id = `char-${i}`
    crdt.insert('x', afterId, id)
    ids.push(id)
    afterId = id
  }

  // Verify pasted content
  let text = crdt.getText()
  assertEquals(text.length, 5000, "should have 5,000 chars after paste")

  // Delete first 10 characters (simulating deleting words at beginning)
  for (let i = 0; i < 10; i++) {
    crdt.delete(ids[i])
  }

  // This should NOT cause stack overflow
  text = crdt.getText()
  assertEquals(text.length, 4990, "should have 4,990 chars after deletion")

  // getVisibleChars should also work
  const visibleChars = crdt.getVisibleChars()
  assertEquals(visibleChars.length, 4990, "getVisibleChars should return 4,990")
})

// Test 5: getIdAtOffset on large document
console.log("\n[Test 5] getIdAtOffset() on large document")
runTest("getIdAtOffset on 10,000 chars", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  for (let i = 0; i < 10000; i++) {
    crdt.insert('b', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  // Get ID at various offsets
  const id0 = crdt.getIdAtOffset(0)
  assertEquals(id0, 'id-0', "offset 0 should be first char")

  const id5000 = crdt.getIdAtOffset(5000)
  assertEquals(id5000, 'id-5000', "offset 5000 should be correct")

  const id9999 = crdt.getIdAtOffset(9999)
  assertEquals(id9999, 'id-9999', "offset 9999 should be last char")
})

// Test 6: getOffsetOfId on large document
console.log("\n[Test 6] getOffsetOfId() on large document")
runTest("getOffsetOfId on 10,000 chars", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  for (let i = 0; i < 10000; i++) {
    crdt.insert('c', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  // Get offset of various IDs
  const offset0 = crdt.getOffsetOfId('id-0')
  assertEquals(offset0, 0, "id-0 should be at offset 0")

  const offset5000 = crdt.getOffsetOfId('id-5000')
  assertEquals(offset5000, 5000, "id-5000 should be at offset 5000")

  const offset9999 = crdt.getOffsetOfId('id-9999')
  assertEquals(offset9999, 9999, "id-9999 should be at offset 9999")
})

// Test 7: findIdByValueAtOffset on large document
console.log("\n[Test 7] findIdByValueAtOffset() on large document")
runTest("findIdByValueAtOffset on 10,000 chars", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  // Insert 10,000 'z' characters
  for (let i = 0; i < 10000; i++) {
    crdt.insert('z', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  // Find 'z' at various offsets
  const found0 = crdt.findIdByValueAtOffset('z', 0)
  assertEquals(found0, 'id-0', "should find id-0 at offset 0")

  const found5000 = crdt.findIdByValueAtOffset('z', 5000)
  assertEquals(found5000, 'id-5000', "should find id-5000 at offset 5000")
})

// Test 8: Extreme test - 50,000 characters (stress test)
console.log("\n[Test 8] Extreme stress test - 50,000 characters")
runTest("50,000 character document", () => {
  const crdt = new CRDTText()
  let afterId = 'ROOT'

  console.log("     INFO: Inserting 50,000 characters...")
  for (let i = 0; i < 50000; i++) {
    crdt.insert('S', afterId, `id-${i}`)
    afterId = `id-${i}`
  }

  console.log("     INFO: Getting text (should not stack overflow)...")
  const text = crdt.getText()
  assertEquals(text.length, 50000, "should have 50,000 characters")

  console.log("     INFO: Getting visible chars (should not stack overflow)...")
  const chars = crdt.getVisibleChars()
  assertEquals(chars.length, 50000, "should return 50,000 visible chars")

  console.log("     INFO: Deleting first 100 characters...")
  for (let i = 0; i < 100; i++) {
    crdt.delete(`id-${i}`)
  }

  console.log("     INFO: Verifying text after deletion...")
  const textAfter = crdt.getText()
  assertEquals(textAfter.length, 49900, "should have 49,900 chars after deletion")
})

console.log("\n" + "=".repeat(60))
console.log("Large Document Test Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${testCount}`)
console.log(`✅ Passed: ${passCount}`)
console.log(`❌ Failed: ${testCount - passCount}`)
console.log("=".repeat(60))

if (passCount === testCount) {
  console.log("\n✅ All large document tests passed!")
  console.log("✅ Stack overflow bug is FIXED!\n")
  process.exit(0)
} else {
  console.log(`\n❌ ${testCount - passCount} test(s) failed\n`)
  process.exit(1)
}

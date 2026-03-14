const CRDTText = require("../../server/crdt/text")

// Test utilities
let passedTests = 0
let failedTests = 0

function assert(condition, message) {
  if (!condition) {
    console.log(`  ❌ FAILED: ${message}`)
    failedTests++
    return false
  } else {
    console.log(`  ✅ PASSED: ${message}`)
    passedTests++
    return true
  }
}

function assertEquals(actual, expected, message) {
  const passed = actual === expected
  if (!passed) {
    console.log(`  ❌ FAILED: ${message}`)
    console.log(`     Expected: ${JSON.stringify(expected)}`)
    console.log(`     Actual:   ${JSON.stringify(actual)}`)
    failedTests++
  } else {
    console.log(`  ✅ PASSED: ${message}`)
    passedTests++
  }
  return passed
}

console.log("=".repeat(60))
console.log("UNIT TESTS: CRDT Text")
console.log("=".repeat(60))

// Test 1: Constructor
console.log("\n[Test 1] Constructor initializes correctly")
const crdt1 = new CRDTText()
assert(crdt1.root === "ROOT", "root is set to 'ROOT'")
assert(crdt1.chars.size === 1, "chars Map has 1 entry (ROOT)")
assert(crdt1.chars.has("ROOT"), "ROOT node exists in chars Map")
const rootNode = crdt1.chars.get("ROOT")
assert(rootNode.id === "ROOT", "ROOT node has correct id")
assert(rootNode.value === "", "ROOT node has empty value")
assert(rootNode.deleted === false, "ROOT node is not deleted")
assert(Array.isArray(rootNode.right), "ROOT node has right array")

// Test 2: insert() - basic insertion
console.log("\n[Test 2] insert() - basic single character insertion")
const crdt2 = new CRDTText()
crdt2.insert("A", "ROOT", "id1")
assertEquals(crdt2.chars.size, 2, "chars Map has 2 entries")
assert(crdt2.chars.has("id1"), "new char exists in chars Map")
const charA = crdt2.chars.get("id1")
assertEquals(charA.value, "A", "char has correct value")
assertEquals(charA.left, "ROOT", "char has correct left pointer")
assert(Array.isArray(charA.right), "char has right array")
assertEquals(charA.deleted, false, "char is not deleted")

// Test 3: insert() - sequential insertions
console.log("\n[Test 3] insert() - sequential insertions")
const crdt3 = new CRDTText()
crdt3.insert("H", "ROOT", "1")
crdt3.insert("E", "1", "2")
crdt3.insert("L", "2", "3")
crdt3.insert("L", "3", "4")
crdt3.insert("O", "4", "5")
assertEquals(crdt3.chars.size, 6, "chars Map has 6 entries (ROOT + 5 chars)")
assertEquals(crdt3.getText(), "HELLO", "getText() returns correct text")

// Test 4: insert() - duplicate id rejection
console.log("\n[Test 4] insert() - rejects duplicate IDs")
const crdt4 = new CRDTText()
crdt4.insert("A", "ROOT", "dup")
crdt4.insert("B", "ROOT", "dup") // Should be rejected
assertEquals(crdt4.chars.size, 2, "duplicate insert is rejected")
assertEquals(crdt4.getText(), "A", "only first insert is applied")

// Test 5: insert() - invalid afterId
console.log("\n[Test 5] insert() - handles invalid afterId")
const crdt5 = new CRDTText()
crdt5.insert("A", "NONEXISTENT", "id1")
assertEquals(crdt5.chars.size, 1, "insert with invalid afterId is rejected")
assertEquals(crdt5.getText(), "", "text remains empty")

// Test 6: getText() - empty document
console.log("\n[Test 6] getText() - returns empty string for empty document")
const crdt6 = new CRDTText()
assertEquals(crdt6.getText(), "", "getText() returns empty string")

// Test 7: getText() - with deleted characters
console.log("\n[Test 7] getText() - excludes deleted characters")
const crdt7 = new CRDTText()
crdt7.insert("A", "ROOT", "1")
crdt7.insert("B", "1", "2")
crdt7.insert("C", "2", "3")
crdt7.delete("2") // Delete B
assertEquals(crdt7.getText(), "AC", "getText() excludes deleted char")

// Test 8: delete() - basic deletion
console.log("\n[Test 8] delete() - marks character as deleted")
const crdt8 = new CRDTText()
crdt8.insert("A", "ROOT", "id1")
assertEquals(crdt8.chars.get("id1").deleted, false, "char initially not deleted")
crdt8.delete("id1")
assertEquals(crdt8.chars.get("id1").deleted, true, "char is marked as deleted")
assertEquals(crdt8.getText(), "", "deleted char not in text")

// Test 9: delete() - nonexistent id
console.log("\n[Test 9] delete() - handles nonexistent ID gracefully")
const crdt9 = new CRDTText()
crdt9.insert("A", "ROOT", "id1")
crdt9.delete("NONEXISTENT") // Should not crash
assertEquals(crdt9.chars.size, 2, "chars Map unchanged")
assertEquals(crdt9.getText(), "A", "text unchanged")

// Test 10: getVisibleChars() - correct order
console.log("\n[Test 10] getVisibleChars() - returns chars in document order")
const crdt10 = new CRDTText()
crdt10.insert("H", "ROOT", "1")
crdt10.insert("E", "1", "2")
crdt10.insert("L", "2", "3")
const visible = crdt10.getVisibleChars()
assertEquals(visible.length, 3, "returns 3 visible chars")
assertEquals(visible[0].value, "H", "first char is H")
assertEquals(visible[1].value, "E", "second char is E")
assertEquals(visible[2].value, "L", "third char is L")

// Test 11: getVisibleChars() - excludes deleted
console.log("\n[Test 11] getVisibleChars() - excludes deleted characters")
const crdt11 = new CRDTText()
crdt11.insert("A", "ROOT", "1")
crdt11.insert("B", "1", "2")
crdt11.insert("C", "2", "3")
crdt11.delete("2")
const visible11 = crdt11.getVisibleChars()
assertEquals(visible11.length, 2, "returns 2 visible chars")
assertEquals(visible11[0].value, "A", "first char is A")
assertEquals(visible11[1].value, "C", "second char is C")

// Test 12: getVisibleChars() - excludes ROOT
console.log("\n[Test 12] getVisibleChars() - excludes ROOT node")
const crdt12 = new CRDTText()
crdt12.insert("A", "ROOT", "1")
const visible12 = crdt12.getVisibleChars()
assertEquals(visible12.length, 1, "returns 1 char (not ROOT)")
assert(visible12.every(c => c.id !== "ROOT"), "ROOT is excluded")

// Test 13: getIdAtOffset() - valid offsets
console.log("\n[Test 13] getIdAtOffset() - returns correct ID for valid offsets")
const crdt13 = new CRDTText()
crdt13.insert("A", "ROOT", "1")
crdt13.insert("B", "1", "2")
crdt13.insert("C", "2", "3")
assertEquals(crdt13.getIdAtOffset(-1), "ROOT", "offset -1 returns ROOT")
assertEquals(crdt13.getIdAtOffset(0), "1", "offset 0 returns first char")
assertEquals(crdt13.getIdAtOffset(1), "2", "offset 1 returns second char")
assertEquals(crdt13.getIdAtOffset(2), "3", "offset 2 returns third char")

// Test 14: getIdAtOffset() - out of bounds
console.log("\n[Test 14] getIdAtOffset() - handles out of bounds offsets")
const crdt14 = new CRDTText()
crdt14.insert("A", "ROOT", "1")
assertEquals(crdt14.getIdAtOffset(100), "ROOT", "large offset returns ROOT")
assertEquals(crdt14.getIdAtOffset(-100), "ROOT", "negative offset returns ROOT")

// Test 15: getOffsetOfId() - valid IDs
console.log("\n[Test 15] getOffsetOfId() - returns correct offset for valid IDs")
const crdt15 = new CRDTText()
crdt15.insert("A", "ROOT", "1")
crdt15.insert("B", "1", "2")
crdt15.insert("C", "2", "3")
assertEquals(crdt15.getOffsetOfId("1"), 0, "first char at offset 0")
assertEquals(crdt15.getOffsetOfId("2"), 1, "second char at offset 1")
assertEquals(crdt15.getOffsetOfId("3"), 2, "third char at offset 2")

// Test 16: getOffsetOfId() - with deleted chars
console.log("\n[Test 16] getOffsetOfId() - skips deleted characters")
const crdt16 = new CRDTText()
crdt16.insert("A", "ROOT", "1")
crdt16.insert("B", "1", "2")
crdt16.insert("C", "2", "3")
crdt16.delete("2")
assertEquals(crdt16.getOffsetOfId("3"), 1, "offset adjusted for deleted char")

// Test 17: getOffsetOfId() - nonexistent ID
console.log("\n[Test 17] getOffsetOfId() - handles nonexistent ID")
const crdt17 = new CRDTText()
crdt17.insert("A", "ROOT", "1")
assertEquals(crdt17.getOffsetOfId("NONEXISTENT"), 1, "returns offset past end")

// Test 18: findIdByValueAtOffset() - finds correct character
console.log("\n[Test 18] findIdByValueAtOffset() - finds character by value and offset")
const crdt18 = new CRDTText()
crdt18.insert("H", "ROOT", "1")
crdt18.insert("E", "1", "2")
crdt18.insert("L", "2", "3")
crdt18.insert("L", "3", "4")
crdt18.insert("O", "4", "5")
assertEquals(crdt18.findIdByValueAtOffset("H", 0), "1", "finds H at offset 0")
assertEquals(crdt18.findIdByValueAtOffset("E", 1), "2", "finds E at offset 1")
assertEquals(crdt18.findIdByValueAtOffset("L", 2), "3", "finds first L at offset 2")
assertEquals(crdt18.findIdByValueAtOffset("L", 3), "4", "finds second L at offset 3")

// Test 19: findIdByValueAtOffset() - no match
console.log("\n[Test 19] findIdByValueAtOffset() - returns null when no match")
const crdt19 = new CRDTText()
crdt19.insert("A", "ROOT", "1")
assertEquals(crdt19.findIdByValueAtOffset("B", 0), null, "returns null for wrong value")
assertEquals(crdt19.findIdByValueAtOffset("A", 5), null, "returns null for wrong offset")

// Test 20: Insertion in middle maintains order
console.log("\n[Test 20] Insert in middle maintains correct order")
const crdt20 = new CRDTText()
crdt20.insert("H", "ROOT", "1")
crdt20.insert("E", "1", "2")
crdt20.insert("L", "2", "3")
crdt20.insert("L", "3", "4")
crdt20.insert("O", "4", "5")
// Insert X between E and first L
crdt20.insert("X", "2", "6")
assertEquals(crdt20.getText(), "HEXLLO", "insert in middle works correctly")
assertEquals(crdt20.getOffsetOfId("6"), 2, "inserted char at correct offset")

// Test 21: Multiple insertions at same position
console.log("\n[Test 21] Multiple insertions at same position (LIFO order)")
const crdt21 = new CRDTText()
crdt21.insert("A", "ROOT", "1")
crdt21.insert("B", "ROOT", "2") // Both after ROOT
crdt21.insert("C", "ROOT", "3") // Both after ROOT
// With unshift, most recent wins: C, B, A
assertEquals(crdt21.getText(), "CBA", "most recent insert appears first")

// Summary
console.log("\n" + "=".repeat(60))
console.log("CRDT Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${passedTests + failedTests}`)
console.log(`✅ Passed: ${passedTests}`)
console.log(`❌ Failed: ${failedTests}`)
console.log("=".repeat(60))

process.exit(failedTests > 0 ? 1 : 0)

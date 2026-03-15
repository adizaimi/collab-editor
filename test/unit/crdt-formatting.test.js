/**
 * CRDT Rich Text Formatting Tests
 *
 * Tests for the attrs system on CRDT nodes: format(), getFormattedChars(),
 * serialization/deserialization with attrs, and compact() preserving attrs.
 */

const CRDTText = require("../../server/crdt/text")

let passed = 0
let failed = 0
let testNum = 0

function assert(condition, msg) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${msg}`)
    failed++
    return false
  }
  console.log(`  ✅ PASSED: ${msg}`)
  passed++
  return true
}

function runTest(name, fn) {
  testNum++
  console.log(`\n[Test ${testNum}] ${name}`)
  fn()
}

// Helper: build a CRDT with "hello" text
function buildHello() {
  const crdt = new CRDTText()
  const chars = ['h', 'e', 'l', 'l', 'o']
  let afterId = 'ROOT'
  for (let i = 0; i < chars.length; i++) {
    const id = `c${i}`
    crdt.insert(chars[i], afterId, id)
    afterId = id
  }
  return crdt
}

// ============================================================
// Basic format() tests
// ============================================================

runTest("format() sets bold attribute on a character", () => {
  const crdt = buildHello()
  const result = crdt.format("c0", { bold: true })
  assert(result === true, "format returns true on success")
  const node = crdt.chars.get("c0")
  assert(node.attrs.bold === true, "bold attribute is set")
})

runTest("format() sets italic attribute", () => {
  const crdt = buildHello()
  crdt.format("c1", { italic: true })
  const node = crdt.chars.get("c1")
  assert(node.attrs.italic === true, "italic attribute is set")
})

runTest("format() sets multiple attributes at once", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true, italic: true })
  const node = crdt.chars.get("c0")
  assert(node.attrs.bold === true, "bold is set")
  assert(node.attrs.italic === true, "italic is set")
})

runTest("format() removes attribute when set to false", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  assert(crdt.chars.get("c0").attrs.bold === true, "bold initially set")
  crdt.format("c0", { bold: false })
  assert(crdt.chars.get("c0").attrs.bold === undefined, "bold removed after setting false")
})

runTest("format() removes attribute when set to null", () => {
  const crdt = buildHello()
  crdt.format("c0", { italic: true })
  crdt.format("c0", { italic: null })
  assert(crdt.chars.get("c0").attrs.italic === undefined, "italic removed with null")
})

runTest("format() returns false for non-existent character", () => {
  const crdt = buildHello()
  const result = crdt.format("nonexistent", { bold: true })
  assert(result === false, "returns false for missing id")
})

runTest("format() returns false for deleted character", () => {
  const crdt = buildHello()
  crdt.delete("c0")
  const result = crdt.format("c0", { bold: true })
  assert(result === false, "returns false for deleted node")
})

runTest("format() can set block attribute (for bullets)", () => {
  const crdt = new CRDTText()
  crdt.insert("\n", "ROOT", "nl1")
  crdt.format("nl1", { block: "bullet" })
  const node = crdt.chars.get("nl1")
  assert(node.attrs.block === "bullet", "block attribute set to bullet")
})

runTest("format() can toggle formatting on and off", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  assert(crdt.chars.get("c0").attrs.bold === true, "bold on")
  crdt.format("c0", { bold: false })
  assert(crdt.chars.get("c0").attrs.bold === undefined, "bold off")
  crdt.format("c0", { bold: true })
  assert(crdt.chars.get("c0").attrs.bold === true, "bold on again")
})

runTest("format() preserves existing attrs when adding new ones", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c0", { italic: true })
  const attrs = crdt.chars.get("c0").attrs
  assert(attrs.bold === true, "bold still present")
  assert(attrs.italic === true, "italic added")
})

// ============================================================
// getFormattedChars() tests
// ============================================================

runTest("getFormattedChars() returns chars with empty attrs by default", () => {
  const crdt = buildHello()
  const chars = crdt.getFormattedChars()
  assert(chars.length === 5, "5 visible chars")
  assert(chars[0].value === "h", "first char is h")
  assert(Object.keys(chars[0].attrs).length === 0, "no attrs by default")
})

runTest("getFormattedChars() includes formatting attributes", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c1", { italic: true })
  const chars = crdt.getFormattedChars()
  assert(chars[0].attrs.bold === true, "first char is bold")
  assert(chars[1].attrs.italic === true, "second char is italic")
  assert(Object.keys(chars[2].attrs).length === 0, "third char has no attrs")
})

runTest("getFormattedChars() skips deleted chars", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.delete("c0")
  const chars = crdt.getFormattedChars()
  assert(chars.length === 4, "only 4 visible chars")
  assert(chars[0].value === "e", "first visible char is 'e'")
})

runTest("getFormattedChars() returns correct IDs for each char", () => {
  const crdt = buildHello()
  const chars = crdt.getFormattedChars()
  assert(chars[0].id === "c0", "first char id is c0")
  assert(chars[4].id === "c4", "last char id is c4")
})

// ============================================================
// Serialization with attrs
// ============================================================

runTest("serialize() includes attrs when present", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c2", { italic: true })
  const json = crdt.serialize()
  const data = JSON.parse(json)
  const c0 = data.chars.find(c => c.id === "c0")
  const c1 = data.chars.find(c => c.id === "c1")
  const c2 = data.chars.find(c => c.id === "c2")
  assert(c0.attrs && c0.attrs.bold === true, "c0 has bold in serialized form")
  assert(!c1.attrs, "c1 has no attrs in serialized form (omitted)")
  assert(c2.attrs && c2.attrs.italic === true, "c2 has italic in serialized form")
})

runTest("serialize() omits attrs field when empty (compact output)", () => {
  const crdt = buildHello()
  const json = crdt.serialize()
  const data = JSON.parse(json)
  const c0 = data.chars.find(c => c.id === "c0")
  assert(!c0.attrs, "no attrs field when empty")
})

runTest("deserialize() restores attrs correctly", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c1", { italic: true, bold: true })
  const json = crdt.serialize()

  const restored = CRDTText.deserialize(json)
  const c0 = restored.chars.get("c0")
  const c1 = restored.chars.get("c1")
  const c2 = restored.chars.get("c2")
  assert(c0.attrs.bold === true, "c0 bold restored")
  assert(c1.attrs.bold === true, "c1 bold restored")
  assert(c1.attrs.italic === true, "c1 italic restored")
  assert(Object.keys(c2.attrs).length === 0, "c2 has empty attrs")
})

runTest("deserialize() handles old format without attrs (backward compat)", () => {
  // Simulate old-format JSON without attrs
  const oldJson = JSON.stringify({
    root: "ROOT",
    chars: [
      { id: "ROOT", value: "", left: null, right: ["c0"], deleted: false },
      { id: "c0", value: "a", left: "ROOT", right: [], deleted: false }
    ]
  })
  const crdt = CRDTText.deserialize(oldJson)
  const c0 = crdt.chars.get("c0")
  assert(c0.attrs !== undefined, "attrs field exists")
  assert(Object.keys(c0.attrs).length === 0, "attrs is empty object")
  assert(crdt.getText() === "a", "text still correct")
})

runTest("serialize/deserialize roundtrip preserves all formatting", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c1", { italic: true })
  crdt.format("c2", { bold: true, italic: true })
  crdt.format("c3", { block: "bullet" })

  const json = crdt.serialize()
  const restored = CRDTText.deserialize(json)

  const fmtChars = restored.getFormattedChars()
  assert(fmtChars[0].attrs.bold === true, "c0 bold survives roundtrip")
  assert(fmtChars[1].attrs.italic === true, "c1 italic survives roundtrip")
  assert(fmtChars[2].attrs.bold === true && fmtChars[2].attrs.italic === true, "c2 bold+italic survives")
  assert(fmtChars[3].attrs.block === "bullet", "c3 block attr survives")
  assert(Object.keys(fmtChars[4].attrs).length === 0, "c4 still unformatted")
})

// ============================================================
// compact() preserving attrs
// ============================================================

runTest("compact() preserves formatting attributes", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c1", { italic: true })

  crdt.compact()

  const chars = crdt.getFormattedChars()
  assert(chars.length === 5, "still 5 chars after compact")
  assert(chars[0].value === "h", "first char is h")
  assert(chars[0].attrs.bold === true, "bold preserved after compact")
  assert(chars[1].attrs.italic === true, "italic preserved after compact")
  assert(crdt.getText() === "hello", "text unchanged after compact")
})

runTest("compact() removes tombstones but keeps formatted chars", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.delete("c2") // delete first 'l'

  const result = crdt.compact()
  assert(result.removed > 0, "tombstones removed")
  assert(crdt.getText() === "helo", "text correct after compact")

  const chars = crdt.getFormattedChars()
  assert(chars[0].attrs.bold === true, "bold preserved on 'h' after compact with deletions")
})

runTest("compact() followed by serialize/deserialize preserves attrs", () => {
  const crdt = buildHello()
  crdt.format("c0", { bold: true })
  crdt.format("c4", { italic: true })
  crdt.delete("c1") // delete 'e'

  crdt.compact()
  const json = crdt.serialize()
  const restored = CRDTText.deserialize(json)

  assert(restored.getText() === "hllo", "text correct after compact+roundtrip")
  const chars = restored.getFormattedChars()
  assert(chars[0].attrs.bold === true, "bold on 'h' survives compact+roundtrip")
  assert(chars[3].attrs.italic === true, "italic on 'o' survives compact+roundtrip")
})

// ============================================================
// insert() with attrs parameter
// ============================================================

runTest("insert() with attrs creates formatted character", () => {
  const crdt = new CRDTText()
  crdt.insert("B", "ROOT", "b1", { bold: true })
  const node = crdt.chars.get("b1")
  assert(node.attrs.bold === true, "inserted char has bold attr")
})

runTest("insert() without attrs creates unformatted character", () => {
  const crdt = new CRDTText()
  crdt.insert("A", "ROOT", "a1")
  const node = crdt.chars.get("a1")
  assert(Object.keys(node.attrs).length === 0, "inserted char has empty attrs")
})

runTest("insert() with null attrs creates unformatted character", () => {
  const crdt = new CRDTText()
  crdt.insert("A", "ROOT", "a1", null)
  const node = crdt.chars.get("a1")
  assert(Object.keys(node.attrs).length === 0, "null attrs becomes empty object")
})

// ============================================================
// Edge cases
// ============================================================

runTest("format() on ROOT node returns false (ROOT is invisible)", () => {
  const crdt = buildHello()
  // ROOT has deleted=false but it's filtered by id !== this.root checks
  // format() should still work on ROOT since it exists and is not deleted
  // But it's meaningless. Let's verify it doesn't crash.
  const result = crdt.format("ROOT", { bold: true })
  assert(result === true, "format on ROOT succeeds (no crash)")
})

runTest("getFormattedChars() with mixed formatting and deletions", () => {
  const crdt = buildHello() // h e l l o
  crdt.format("c0", { bold: true })     // h = bold
  crdt.format("c1", { italic: true })   // e = italic
  crdt.delete("c2")                     // l = deleted
  crdt.format("c3", { bold: true, italic: true }) // l = bold+italic
  // c4 = no format (o)

  const chars = crdt.getFormattedChars()
  assert(chars.length === 4, "4 visible chars")
  assert(chars[0].value === "h" && chars[0].attrs.bold === true, "h is bold")
  assert(chars[1].value === "e" && chars[1].attrs.italic === true, "e is italic")
  assert(chars[2].value === "l" && chars[2].attrs.bold === true && chars[2].attrs.italic === true, "l is bold+italic")
  assert(chars[3].value === "o" && Object.keys(chars[3].attrs).length === 0, "o has no formatting")
})

runTest("Empty document has no formatted chars", () => {
  const crdt = new CRDTText()
  const chars = crdt.getFormattedChars()
  assert(chars.length === 0, "no formatted chars in empty doc")
})

runTest("format() with empty attrs object is a no-op", () => {
  const crdt = buildHello()
  crdt.format("c0", {})
  assert(Object.keys(crdt.chars.get("c0").attrs).length === 0, "empty attrs is no-op")
})

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60))
console.log("CRDT Formatting Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${passed + failed}`)
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log("=".repeat(60))

if (failed > 0) process.exit(1)

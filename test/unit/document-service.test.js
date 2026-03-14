const DocumentService = require("../../server/services/document")

// Mock storage
class MockStorage {
  constructor() {
    this.operations = []
  }

  init() {}

  saveOperation(docId, op) {
    this.operations.push({ docId, ...op })
  }

  loadOperations(docId) {
    return this.operations
      .filter(op => op.docId === docId)
      .map(op => ({
        type: op.type,
        op_id: op.id,
        value: op.value,
        after_id: op.after
      }))
  }

  clear() {
    this.operations = []
  }
}

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
console.log("UNIT TESTS: DocumentService")
console.log("=".repeat(60))

// Test 1: Constructor
console.log("\n[Test 1] Constructor initializes correctly")
const storage1 = new MockStorage()
const docService1 = new DocumentService(storage1)
assert(docService1.storage === storage1, "storage is set correctly")
assert(docService1.docs instanceof Map, "docs is a Map")
assertEquals(docService1.docs.size, 0, "docs Map is initially empty")

// Test 2: loadDocument() - creates new document
console.log("\n[Test 2] loadDocument() - creates new document if not exists")
const storage2 = new MockStorage()
const docService2 = new DocumentService(storage2)
const doc2 = docService2.loadDocument("doc1")
assert(doc2 !== null, "returns a document")
assert(docService2.docs.has("doc1"), "document is cached in docs Map")
assert(docService2.docs.get("doc1") === doc2, "cached document is the same instance")

// Test 3: loadDocument() - returns cached document
console.log("\n[Test 3] loadDocument() - returns cached document on subsequent calls")
const storage3 = new MockStorage()
const docService3 = new DocumentService(storage3)
const doc3a = docService3.loadDocument("doc1")
const doc3b = docService3.loadDocument("doc1")
assert(doc3a === doc3b, "returns same instance from cache")

// Test 4: loadDocument() - loads operations from storage
console.log("\n[Test 4] loadDocument() - loads operations from storage")
const storage4 = new MockStorage()
storage4.operations = [
  { docId: "doc1", type: "insert", id: "1", value: "H", after: "ROOT" },
  { docId: "doc1", type: "insert", id: "2", value: "I", after: "1" }
]
const docService4 = new DocumentService(storage4)
const doc4 = docService4.loadDocument("doc1")
assertEquals(doc4.getText(), "HI", "loads and applies operations from storage")

// Test 5: loadDocument() - different documents
console.log("\n[Test 5] loadDocument() - manages multiple documents separately")
const storage5 = new MockStorage()
storage5.operations = [
  { docId: "doc1", type: "insert", id: "1", value: "A", after: "ROOT" },
  { docId: "doc2", type: "insert", id: "2", value: "B", after: "ROOT" }
]
const docService5 = new DocumentService(storage5)
const doc5a = docService5.loadDocument("doc1")
const doc5b = docService5.loadDocument("doc2")
assertEquals(doc5a.getText(), "A", "doc1 has correct content")
assertEquals(doc5b.getText(), "B", "doc2 has correct content")
assert(doc5a !== doc5b, "different documents are different instances")

// Test 6: applyOperation() - insert operation
console.log("\n[Test 6] applyOperation() - applies insert operation")
const storage6 = new MockStorage()
const docService6 = new DocumentService(storage6)
docService6.loadDocument("doc1") // Initialize document
docService6.applyOperation("doc1", {
  type: "insert",
  id: "1",
  value: "X",
  after: "ROOT"
})
assertEquals(docService6.getText("doc1"), "X", "insert operation applied")
assertEquals(storage6.operations.length, 1, "operation saved to storage")
assertEquals(storage6.operations[0].value, "X", "saved operation has correct value")

// Test 7: applyOperation() - delete operation
console.log("\n[Test 7] applyOperation() - applies delete operation")
const storage7 = new MockStorage()
storage7.operations = [
  { docId: "doc1", type: "insert", id: "1", value: "A", after: "ROOT" },
  { docId: "doc1", type: "insert", id: "2", value: "B", after: "1" }
]
const docService7 = new DocumentService(storage7)
docService7.loadDocument("doc1")
storage7.clear()
docService7.applyOperation("doc1", { type: "delete", id: "1" })
assertEquals(docService7.getText("doc1"), "B", "delete operation applied")
assertEquals(storage7.operations.length, 1, "delete operation saved")
assertEquals(storage7.operations[0].type, "delete", "saved operation is delete")

// Test 8: applyOperation() - loads document if not cached
console.log("\n[Test 8] applyOperation() - loads document if not in cache")
const storage8 = new MockStorage()
const docService8 = new DocumentService(storage8)
docService8.applyOperation("doc1", {
  type: "insert",
  id: "1",
  value: "Y",
  after: "ROOT"
})
assert(docService8.docs.has("doc1"), "document is loaded and cached")
assertEquals(docService8.getText("doc1"), "Y", "operation applied to loaded document")

// Test 9: getText() - returns document text
console.log("\n[Test 9] getText() - returns correct document text")
const storage9 = new MockStorage()
storage9.operations = [
  { docId: "doc1", type: "insert", id: "1", value: "T", after: "ROOT" },
  { docId: "doc1", type: "insert", id: "2", value: "E", after: "1" },
  { docId: "doc1", type: "insert", id: "3", value: "S", after: "2" },
  { docId: "doc1", type: "insert", id: "4", value: "T", after: "3" }
]
const docService9 = new DocumentService(storage9)
assertEquals(docService9.getText("doc1"), "TEST", "getText() returns correct text")

// Test 10: getCRDT() - returns CRDT instance
console.log("\n[Test 10] getCRDT() - returns CRDT instance")
const storage10 = new MockStorage()
const docService10 = new DocumentService(storage10)
const crdt10 = docService10.getCRDT("doc1")
assert(crdt10 !== null, "returns CRDT instance")
assert(typeof crdt10.insert === "function", "CRDT has insert method")
assert(typeof crdt10.delete === "function", "CRDT has delete method")
assert(typeof crdt10.getText === "function", "CRDT has getText method")

// Test 11: getCRDT() - returns same instance as loadDocument
console.log("\n[Test 11] getCRDT() - returns same instance as loadDocument")
const storage11 = new MockStorage()
const docService11 = new DocumentService(storage11)
const doc11 = docService11.loadDocument("doc1")
const crdt11 = docService11.getCRDT("doc1")
assert(doc11 === crdt11, "getCRDT and loadDocument return same instance")

// Test 12: Sequential operations
console.log("\n[Test 12] Sequential operations maintain correct state")
const storage12 = new MockStorage()
const docService12 = new DocumentService(storage12)
docService12.applyOperation("doc1", { type: "insert", id: "1", value: "A", after: "ROOT" })
docService12.applyOperation("doc1", { type: "insert", id: "2", value: "B", after: "1" })
docService12.applyOperation("doc1", { type: "insert", id: "3", value: "C", after: "2" })
docService12.applyOperation("doc1", { type: "delete", id: "2" })
assertEquals(docService12.getText("doc1"), "AC", "sequential operations work correctly")
assertEquals(storage12.operations.length, 4, "all operations saved")

// Test 13: Persistence across service instances
console.log("\n[Test 13] Persistence - new service instance loads saved operations")
const storage13 = new MockStorage()
const docService13a = new DocumentService(storage13)
docService13a.applyOperation("doc1", { type: "insert", id: "1", value: "P", after: "ROOT" })
docService13a.applyOperation("doc1", { type: "insert", id: "2", value: "Q", after: "1" })
// Create new service instance with same storage
const docService13b = new DocumentService(storage13)
assertEquals(docService13b.getText("doc1"), "PQ", "new instance loads persisted operations")

// Summary
console.log("\n" + "=".repeat(60))
console.log("DocumentService Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${passedTests + failedTests}`)
console.log(`✅ Passed: ${passedTests}`)
console.log(`❌ Failed: ${failedTests}`)
console.log("=".repeat(60))

process.exit(failedTests > 0 ? 1 : 0)

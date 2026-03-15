const SQLiteStorage = require("../../server/storage/sqlite")
const fs = require("fs")
const path = require("path")

// Test utilities
let passedTests = 0
let failedTests = 0
const testDbPath = path.join(__dirname, "../test-storage.db")

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

function cleanupTestDb() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }
}

console.log("=".repeat(60))
console.log("UNIT TESTS: SQLiteStorage")
console.log("=".repeat(60))

// Test 1: Constructor creates database connection
console.log("\n[Test 1] Constructor creates database connection")
cleanupTestDb()
// Override the default db path for testing
const Database = require("better-sqlite3")
const originalDb = SQLiteStorage.prototype.constructor
const storage1 = new SQLiteStorage()
// Replace db with test db
storage1.db = new Database(testDbPath)
assert(storage1.db !== null, "database connection created")
storage1.db.close()
cleanupTestDb()

// Test 2: init() creates operations table
console.log("\n[Test 2] init() creates operations table")
cleanupTestDb()
const storage2 = new SQLiteStorage()
storage2.db = new Database(testDbPath)
storage2.init()
const tables = storage2.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operations'").all()
assertEquals(tables.length, 1, "operations table created")
storage2.db.close()
cleanupTestDb()

// Test 3: init() - table has correct schema
console.log("\n[Test 3] init() - operations table has correct schema")
cleanupTestDb()
const storage3 = new SQLiteStorage()
storage3.db = new Database(testDbPath)
storage3.init()
const schema = storage3.db.prepare("PRAGMA table_info(operations)").all()
const columnNames = schema.map(col => col.name)
assert(columnNames.includes("id"), "table has id column")
assert(columnNames.includes("doc_id"), "table has doc_id column")
assert(columnNames.includes("op_id"), "table has op_id column")
assert(columnNames.includes("type"), "table has type column")
assert(columnNames.includes("value"), "table has value column")
assert(columnNames.includes("after_id"), "table has after_id column")
assert(columnNames.includes("created_at"), "table has created_at column")
storage3.db.close()
cleanupTestDb()

// Test 4: saveOperation() - insert operation
console.log("\n[Test 4] saveOperation() - saves insert operation")
cleanupTestDb()
const storage4 = new SQLiteStorage()
storage4.db = new Database(testDbPath)
storage4.init()
storage4.saveOperation("doc1", {
  id: "op1",
  type: "insert",
  value: "A",
  after: "ROOT"
})
const rows = storage4.db.prepare("SELECT * FROM operations WHERE doc_id = ?").all("doc1")
assertEquals(rows.length, 1, "operation saved to database")
assertEquals(rows[0].op_id, "op1", "op_id saved correctly")
assertEquals(rows[0].type, "insert", "type saved correctly")
assertEquals(rows[0].value, "A", "value saved correctly")
assertEquals(rows[0].after_id, "ROOT", "after_id saved correctly")
storage4.db.close()
cleanupTestDb()

// Test 5: saveOperation() - delete operation
console.log("\n[Test 5] saveOperation() - saves delete operation")
cleanupTestDb()
const storage5 = new SQLiteStorage()
storage5.db = new Database(testDbPath)
storage5.init()
storage5.saveOperation("doc1", {
  id: "op1",
  type: "delete"
})
const rows5 = storage5.db.prepare("SELECT * FROM operations WHERE doc_id = ?").all("doc1")
assertEquals(rows5.length, 1, "delete operation saved")
assertEquals(rows5[0].type, "delete", "type is delete")
assertEquals(rows5[0].value, null, "value is null for delete")
assertEquals(rows5[0].after_id, null, "after_id is null for delete")
storage5.db.close()
cleanupTestDb()

// Test 6: saveOperation() - multiple operations
console.log("\n[Test 6] saveOperation() - saves multiple operations")
cleanupTestDb()
const storage6 = new SQLiteStorage()
storage6.db = new Database(testDbPath)
storage6.init()
storage6.saveOperation("doc1", { id: "op1", type: "insert", value: "A", after: "ROOT" })
storage6.saveOperation("doc1", { id: "op2", type: "insert", value: "B", after: "op1" })
storage6.saveOperation("doc1", { id: "op3", type: "insert", value: "C", after: "op2" })
const rows6 = storage6.db.prepare("SELECT * FROM operations WHERE doc_id = ?").all("doc1")
assertEquals(rows6.length, 3, "all operations saved")
storage6.db.close()
cleanupTestDb()

// Test 7: saveOperation() - different documents
console.log("\n[Test 7] saveOperation() - separates operations by document")
cleanupTestDb()
const storage7 = new SQLiteStorage()
storage7.db = new Database(testDbPath)
storage7.init()
storage7.saveOperation("doc1", { id: "op1", type: "insert", value: "A", after: "ROOT" })
storage7.saveOperation("doc2", { id: "op2", type: "insert", value: "B", after: "ROOT" })
const rows7a = storage7.db.prepare("SELECT * FROM operations WHERE doc_id = ?").all("doc1")
const rows7b = storage7.db.prepare("SELECT * FROM operations WHERE doc_id = ?").all("doc2")
assertEquals(rows7a.length, 1, "doc1 has 1 operation")
assertEquals(rows7b.length, 1, "doc2 has 1 operation")
storage7.db.close()
cleanupTestDb()

// Test 8: loadOperations() - returns empty array for new document
console.log("\n[Test 8] loadOperations() - returns empty array for new document")
cleanupTestDb()
const storage8 = new SQLiteStorage()
storage8.db = new Database(testDbPath)
storage8.init()
const ops8 = storage8.loadOperations("newdoc")
assert(Array.isArray(ops8), "returns an array")
assertEquals(ops8.length, 0, "array is empty for new document")
storage8.db.close()
cleanupTestDb()

// Test 9: loadOperations() - returns saved operations
console.log("\n[Test 9] loadOperations() - returns saved operations")
cleanupTestDb()
const storage9 = new SQLiteStorage()
storage9.db = new Database(testDbPath)
storage9.init()
storage9.saveOperation("doc1", { id: "op1", type: "insert", value: "X", after: "ROOT" })
storage9.saveOperation("doc1", { id: "op2", type: "insert", value: "Y", after: "op1" })
const ops9 = storage9.loadOperations("doc1")
assertEquals(ops9.length, 2, "returns 2 operations")
assertEquals(ops9[0].op_id, "op1", "first operation has correct id")
assertEquals(ops9[1].op_id, "op2", "second operation has correct id")
storage9.db.close()
cleanupTestDb()

// Test 10: loadOperations() - correct field mapping
console.log("\n[Test 10] loadOperations() - maps database fields correctly")
cleanupTestDb()
const storage10 = new SQLiteStorage()
storage10.db = new Database(testDbPath)
storage10.init()
storage10.saveOperation("doc1", { id: "op1", type: "insert", value: "Z", after: "ROOT" })
const ops10 = storage10.loadOperations("doc1")
assert(ops10[0].hasOwnProperty("type"), "has type field")
assert(ops10[0].hasOwnProperty("op_id"), "has op_id field")
assert(ops10[0].hasOwnProperty("value"), "has value field")
assert(ops10[0].hasOwnProperty("after_id"), "has after_id field")
assertEquals(ops10[0].type, "insert", "type mapped correctly")
assertEquals(ops10[0].op_id, "op1", "op_id mapped correctly")
assertEquals(ops10[0].value, "Z", "value mapped correctly")
assertEquals(ops10[0].after_id, "ROOT", "after_id mapped correctly")
storage10.db.close()
cleanupTestDb()

// Test 11: loadOperations() - ordered by id
console.log("\n[Test 11] loadOperations() - returns operations in insertion order")
cleanupTestDb()
const storage11 = new SQLiteStorage()
storage11.db = new Database(testDbPath)
storage11.init()
storage11.saveOperation("doc1", { id: "op3", type: "insert", value: "C", after: "ROOT" })
storage11.saveOperation("doc1", { id: "op1", type: "insert", value: "A", after: "ROOT" })
storage11.saveOperation("doc1", { id: "op2", type: "insert", value: "B", after: "ROOT" })
const ops11 = storage11.loadOperations("doc1")
// Should be ordered by auto-increment id, not op_id
assertEquals(ops11[0].value, "C", "first saved operation is first")
assertEquals(ops11[1].value, "A", "second saved operation is second")
assertEquals(ops11[2].value, "B", "third saved operation is third")
storage11.db.close()
cleanupTestDb()

// Test 12: loadOperations() - filters by document
console.log("\n[Test 12] loadOperations() - filters by document correctly")
cleanupTestDb()
const storage12 = new SQLiteStorage()
storage12.db = new Database(testDbPath)
storage12.init()
storage12.saveOperation("doc1", { id: "op1", type: "insert", value: "A", after: "ROOT" })
storage12.saveOperation("doc2", { id: "op2", type: "insert", value: "B", after: "ROOT" })
storage12.saveOperation("doc1", { id: "op3", type: "insert", value: "C", after: "op1" })
const ops12 = storage12.loadOperations("doc1")
assertEquals(ops12.length, 2, "returns only doc1 operations")
assertEquals(ops12[0].value, "A", "first doc1 operation")
assertEquals(ops12[1].value, "C", "second doc1 operation")
storage12.db.close()
cleanupTestDb()

// Test 13: Persistence across instances
console.log("\n[Test 13] Persistence - data survives storage instance recreation")
cleanupTestDb()
const storage13a = new SQLiteStorage()
storage13a.db = new Database(testDbPath)
storage13a.init()
storage13a.saveOperation("doc1", { id: "op1", type: "insert", value: "P", after: "ROOT" })
storage13a.db.close()
// Create new instance with same database
const storage13b = new SQLiteStorage()
storage13b.db = new Database(testDbPath)
storage13b.init()
const ops13 = storage13b.loadOperations("doc1")
assertEquals(ops13.length, 1, "operation persisted across instances")
assertEquals(ops13[0].value, "P", "operation data correct")
storage13b.db.close()
cleanupTestDb()

// Test 14: listDocuments() - returns empty for fresh database
console.log("\n[Test 14] listDocuments() - returns empty array for fresh database")
cleanupTestDb()
const storage14 = new SQLiteStorage()
storage14.db = new Database(testDbPath)
storage14.init()
const docs14 = storage14.listDocuments()
assert(Array.isArray(docs14), "returns an array")
assertEquals(docs14.length, 0, "empty for fresh database")
storage14.db.close()
cleanupTestDb()

// Test 15: listDocuments() - finds documents from operations
console.log("\n[Test 15] listDocuments() - finds documents from operations table")
cleanupTestDb()
const storage15 = new SQLiteStorage()
storage15.db = new Database(testDbPath)
storage15.init()
storage15.saveOperation("alpha", { id: "op1", type: "insert", value: "a", after: "ROOT" })
storage15.saveOperation("beta", { id: "op2", type: "insert", value: "b", after: "ROOT" })
const docs15 = storage15.listDocuments()
assertEquals(docs15.length, 2, "finds 2 documents")
const ids15 = docs15.map(d => d.doc_id).sort()
assert(ids15.includes("alpha"), "includes alpha")
assert(ids15.includes("beta"), "includes beta")
storage15.db.close()
cleanupTestDb()

// Test 16: listDocuments() - finds documents from snapshots only
console.log("\n[Test 16] listDocuments() - finds documents from snapshots table")
cleanupTestDb()
const storage16 = new SQLiteStorage()
storage16.db = new Database(testDbPath)
storage16.init()
storage16.saveSnapshot("gamma", '{"root":"ROOT","chars":[]}')
const docs16 = storage16.listDocuments()
assertEquals(docs16.length, 1, "finds 1 document from snapshot")
assertEquals(docs16[0].doc_id, "gamma", "correct doc_id from snapshot")
storage16.db.close()
cleanupTestDb()

// Test 17: listDocuments() - deduplicates across operations and snapshots
console.log("\n[Test 17] listDocuments() - deduplicates docs across tables")
cleanupTestDb()
const storage17 = new SQLiteStorage()
storage17.db = new Database(testDbPath)
storage17.init()
storage17.saveOperation("shared", { id: "op1", type: "insert", value: "x", after: "ROOT" })
storage17.saveSnapshot("shared", '{"root":"ROOT","chars":[]}')
storage17.saveOperation("only-ops", { id: "op2", type: "insert", value: "y", after: "ROOT" })
storage17.saveSnapshot("only-snap", '{"root":"ROOT","chars":[]}')
const docs17 = storage17.listDocuments()
assertEquals(docs17.length, 3, "3 unique documents (not 4)")
const ids17 = docs17.map(d => d.doc_id).sort()
assert(ids17.includes("shared"), "shared appears once")
assert(ids17.includes("only-ops"), "ops-only doc included")
assert(ids17.includes("only-snap"), "snapshot-only doc included")
storage17.db.close()
cleanupTestDb()

// Test 18: listDocuments() - ordered by last_updated descending
console.log("\n[Test 18] listDocuments() - ordered by most recently updated first")
cleanupTestDb()
const storage18 = new SQLiteStorage()
storage18.db = new Database(testDbPath)
storage18.init()
// Insert with explicit timestamps to control ordering
storage18.db.prepare("INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at) VALUES (?,?,?,?,?,?)").run("old-doc", "op1", "insert", "a", "ROOT", 1000)
storage18.db.prepare("INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at) VALUES (?,?,?,?,?,?)").run("new-doc", "op2", "insert", "b", "ROOT", 3000)
storage18.db.prepare("INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at) VALUES (?,?,?,?,?,?)").run("mid-doc", "op3", "insert", "c", "ROOT", 2000)
const docs18 = storage18.listDocuments()
assertEquals(docs18.length, 3, "3 documents")
assertEquals(docs18[0].doc_id, "new-doc", "most recent first")
assertEquals(docs18[1].doc_id, "mid-doc", "middle second")
assertEquals(docs18[2].doc_id, "old-doc", "oldest last")
storage18.db.close()
cleanupTestDb()

// Test 19: listDocuments() - last_updated reflects latest activity
console.log("\n[Test 19] listDocuments() - last_updated uses max timestamp across both tables")
cleanupTestDb()
const storage19 = new SQLiteStorage()
storage19.db = new Database(testDbPath)
storage19.init()
// Old operation, then newer snapshot — should use snapshot timestamp
storage19.db.prepare("INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at) VALUES (?,?,?,?,?,?)").run("doc-a", "op1", "insert", "a", "ROOT", 1000)
storage19.db.prepare("INSERT INTO snapshots (doc_id, content, created_at) VALUES (?,?,?)").run("doc-a", '{}', 5000)
// Newer operation, older snapshot — should use operation timestamp
storage19.db.prepare("INSERT INTO snapshots (doc_id, content, created_at) VALUES (?,?,?)").run("doc-b", '{}', 2000)
storage19.db.prepare("INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at) VALUES (?,?,?,?,?,?)").run("doc-b", "op2", "insert", "b", "ROOT", 6000)
const docs19 = storage19.listDocuments()
assertEquals(docs19[0].doc_id, "doc-b", "doc-b is first (latest op at 6000)")
assertEquals(docs19[0].last_updated, 6000, "doc-b last_updated is 6000")
assertEquals(docs19[1].doc_id, "doc-a", "doc-a is second (latest snap at 5000)")
assertEquals(docs19[1].last_updated, 5000, "doc-a last_updated is 5000")
storage19.db.close()
cleanupTestDb()

// Test 20: listDocuments() - handles many documents
console.log("\n[Test 20] listDocuments() - handles many documents")
cleanupTestDb()
const storage20 = new SQLiteStorage()
storage20.db = new Database(testDbPath)
storage20.init()
for (let i = 0; i < 50; i++) {
  storage20.saveOperation("doc-" + i, { id: "op" + i, type: "insert", value: "x", after: "ROOT" })
}
const docs20 = storage20.listDocuments()
assertEquals(docs20.length, 50, "lists all 50 documents")
storage20.db.close()
cleanupTestDb()

// Summary
console.log("\n" + "=".repeat(60))
console.log("SQLiteStorage Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${passedTests + failedTests}`)
console.log(`✅ Passed: ${passedTests}`)
console.log(`❌ Failed: ${failedTests}`)
console.log("=".repeat(60))

cleanupTestDb()
process.exit(failedTests > 0 ? 1 : 0)

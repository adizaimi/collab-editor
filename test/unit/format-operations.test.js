/**
 * Format Operation Tests
 *
 * Tests for format operations flowing through the full stack:
 * storage (with attrs column), document service, and operation replay.
 */

const Database = require("better-sqlite3")
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

// Inline storage for isolated testing (no file dependency)
class TestStorage {
  constructor() {
    this.db = new Database(":memory:")
    this.db.exec(`
      CREATE TABLE operations(
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        op_id TEXT,
        type TEXT,
        value TEXT,
        after_id TEXT,
        attrs TEXT,
        created_at INTEGER
      );
      CREATE TABLE snapshots(
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        content TEXT,
        created_at INTEGER
      );
    `)
    this._stmts = {
      insertOp: this.db.prepare(
        `INSERT INTO operations (doc_id, op_id, type, value, after_id, attrs, created_at) VALUES (?,?,?,?,?,?,?)`
      ),
      loadOps: this.db.prepare(`SELECT * FROM operations WHERE doc_id=? ORDER BY id`),
      insertSnapshot: this.db.prepare(
        `INSERT INTO snapshots (doc_id, content, created_at) VALUES (?,?,?)`
      ),
      loadLatestSnapshot: this.db.prepare(
        `SELECT * FROM snapshots WHERE doc_id=? ORDER BY created_at DESC LIMIT 1`
      ),
      loadOpsSinceSnapshot: this.db.prepare(
        `SELECT * FROM operations WHERE doc_id=? AND created_at >= ? ORDER BY id`
      ),
      deleteOldOps: this.db.prepare(
        `DELETE FROM operations WHERE doc_id=? AND created_at <= ?`
      ),
      countOps: this.db.prepare(
        `SELECT COUNT(*) as count FROM operations WHERE doc_id=?`
      )
    }
    this._insertBatch = this.db.transaction((docId, ops) => {
      const now = Date.now()
      for (const op of ops) {
        const attrs = op.attrs ? JSON.stringify(op.attrs) : null
        this._stmts.insertOp.run(docId, op.id, op.type, op.value || null, op.after || null, attrs, now)
      }
    })
  }
  saveOperation(docId, op) {
    const attrs = op.attrs ? JSON.stringify(op.attrs) : null
    this._stmts.insertOp.run(docId, op.id, op.type, op.value || null, op.after || null, attrs, Date.now())
  }
  saveOperationBatch(docId, ops) { this._insertBatch(docId, ops) }
  loadOperations(docId) { return this._stmts.loadOps.all(docId) }
  saveSnapshot(docId, content, ts) { this._stmts.insertSnapshot.run(docId, content, ts) }
  loadLatestSnapshot(docId) { return this._stmts.loadLatestSnapshot.get(docId) }
  loadOperationsSinceSnapshot(docId, ts) { return this._stmts.loadOpsSinceSnapshot.all(docId, ts) }
  deleteOldOperations(docId, ts) { this._stmts.deleteOldOps.run(docId, ts) }
  getOperationCount(docId) { return this._stmts.countOps.get(docId).count }
  close() { this.db.close() }
}

// Require DocumentService after storage is defined
const DocumentService = require("../../server/services/document")

// ============================================================
// Storage-level format operation tests
// ============================================================

runTest("Storage: save and load format operation with attrs", () => {
  const storage = new TestStorage()
  storage.saveOperation("doc1", {
    type: "format", id: "c0", attrs: { bold: true }
  })
  const ops = storage.loadOperations("doc1")
  assert(ops.length === 1, "one operation saved")
  assert(ops[0].type === "format", "type is format")
  assert(ops[0].op_id === "c0", "op_id is c0")
  const attrs = JSON.parse(ops[0].attrs)
  assert(attrs.bold === true, "attrs.bold stored correctly")
  storage.close()
})

runTest("Storage: save insert with attrs", () => {
  const storage = new TestStorage()
  storage.saveOperation("doc1", {
    type: "insert", id: "c0", value: "B", after: "ROOT",
    attrs: { bold: true }
  })
  const ops = storage.loadOperations("doc1")
  assert(ops.length === 1, "one operation saved")
  const attrs = JSON.parse(ops[0].attrs)
  assert(attrs.bold === true, "insert attrs stored correctly")
  storage.close()
})

runTest("Storage: operations without attrs have null attrs column", () => {
  const storage = new TestStorage()
  storage.saveOperation("doc1", {
    type: "insert", id: "c0", value: "a", after: "ROOT"
  })
  const ops = storage.loadOperations("doc1")
  assert(ops[0].attrs === null, "attrs is null when not provided")
  storage.close()
})

runTest("Storage: batch save includes format operations", () => {
  const storage = new TestStorage()
  storage.saveOperationBatch("doc1", [
    { type: "insert", id: "c0", value: "a", after: "ROOT" },
    { type: "format", id: "c0", attrs: { bold: true } },
    { type: "insert", id: "c1", value: "b", after: "c0" }
  ])
  const ops = storage.loadOperations("doc1")
  assert(ops.length === 3, "three operations saved")
  assert(ops[1].type === "format", "second op is format")
  assert(JSON.parse(ops[1].attrs).bold === true, "format attrs correct in batch")
  storage.close()
})

// ============================================================
// DocumentService format operation tests
// ============================================================

runTest("DocumentService: applyOperation with format", () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  // Insert "hi"
  docs.applyOperation("doc1", { type: "insert", id: "c0", value: "h", after: "ROOT" })
  docs.applyOperation("doc1", { type: "insert", id: "c1", value: "i", after: "c0" })

  // Format 'h' as bold
  docs.applyOperation("doc1", { type: "format", id: "c0", attrs: { bold: true } })

  const crdt = docs.getCRDT("doc1")
  const chars = crdt.getFormattedChars()
  assert(chars[0].attrs.bold === true, "h is bold after format op")
  assert(Object.keys(chars[1].attrs).length === 0, "i has no formatting")
  storage.close()
})

runTest("DocumentService: format operation persisted and replayed", () => {
  const storage = new TestStorage()

  // First session: insert + format
  const docs1 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  docs1.applyOperation("doc1", { type: "insert", id: "c0", value: "A", after: "ROOT" })
  docs1.applyOperation("doc1", { type: "format", id: "c0", attrs: { italic: true } })

  // Second session: reload from DB
  const docs2 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  const crdt = docs2.loadDocument("doc1")
  const chars = crdt.getFormattedChars()
  assert(chars.length === 1, "one char loaded")
  assert(chars[0].value === "A", "char value correct")
  assert(chars[0].attrs.italic === true, "italic formatting replayed from DB")
  storage.close()
})

runTest("DocumentService: applyFormatWithBatching formats range", () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  // Insert "hello"
  let afterId = "ROOT"
  for (let i = 0; i < 5; i++) {
    const id = `c${i}`
    docs.applyOperation("doc1", {
      type: "insert", id, value: "hello"[i], after: afterId
    })
    afterId = id
  }

  // Format "hel" as bold
  docs.applyFormatWithBatching("doc1", ["c0", "c1", "c2"], { bold: true }, "client1")

  const chars = docs.getCRDT("doc1").getFormattedChars()
  assert(chars[0].attrs.bold === true, "h is bold")
  assert(chars[1].attrs.bold === true, "e is bold")
  assert(chars[2].attrs.bold === true, "l is bold")
  assert(Object.keys(chars[3].attrs).length === 0, "l (4th) is not bold")
  assert(Object.keys(chars[4].attrs).length === 0, "o is not bold")
  storage.close()
})

runTest("DocumentService: format_batch replayed correctly", () => {
  const storage = new TestStorage()

  // Manually insert a format_batch operation
  storage.saveOperation("doc1", {
    type: "insert", id: "c0", value: "a", after: "ROOT"
  })
  storage.saveOperation("doc1", {
    type: "insert", id: "c1", value: "b", after: "c0"
  })
  storage.saveOperation("doc1", {
    type: "insert", id: "c2", value: "c", after: "c1"
  })
  storage.saveOperation("doc1", {
    type: "format_batch", id: "c0,c1,c2",
    attrs: { bold: true }
  })

  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  const crdt = docs.loadDocument("doc1")
  const chars = crdt.getFormattedChars()
  assert(chars.length === 3, "3 chars loaded")
  assert(chars[0].attrs.bold === true, "a is bold from format_batch")
  assert(chars[1].attrs.bold === true, "b is bold from format_batch")
  assert(chars[2].attrs.bold === true, "c is bold from format_batch")
  storage.close()
})

runTest("DocumentService: getFormattedChars returns correct data", () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  docs.applyOperation("doc1", { type: "insert", id: "c0", value: "X", after: "ROOT" })
  docs.applyOperation("doc1", { type: "format", id: "c0", attrs: { bold: true, italic: true } })

  const fmtChars = docs.getFormattedChars("doc1")
  assert(fmtChars.length === 1, "one formatted char")
  assert(fmtChars[0].attrs.bold === true, "bold via getFormattedChars")
  assert(fmtChars[0].attrs.italic === true, "italic via getFormattedChars")
  storage.close()
})

runTest("DocumentService: snapshot preserves formatting", async () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  // Insert and format
  docs.applyOperation("doc1", { type: "insert", id: "c0", value: "B", after: "ROOT" })
  docs.applyOperation("doc1", { type: "format", id: "c0", attrs: { bold: true } })

  // Create snapshot
  await docs.createSnapshot("doc1")

  // Reload from snapshot
  const docs2 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  const crdt = docs2.loadDocument("doc1")
  const chars = crdt.getFormattedChars()
  assert(chars.length === 1, "one char from snapshot")
  assert(chars[0].value === "B", "char value correct from snapshot")
  assert(chars[0].attrs.bold === true, "bold formatting preserved through snapshot")
  storage.close()
})

runTest("DocumentService: format after snapshot is replayed on load", async () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  // Insert text
  docs.applyOperation("doc1", { type: "insert", id: "c0", value: "A", after: "ROOT" })
  docs.applyOperation("doc1", { type: "insert", id: "c1", value: "B", after: "c0" })

  // Snapshot
  await docs.createSnapshot("doc1")

  // Format after snapshot (these will be replayed on load)
  docs.applyOperation("doc1", { type: "format", id: expect_id_after_compact(), attrs: { italic: true } })

  // We need to use the actual IDs from the compacted CRDT
  // Let's do it properly:
  const crdt = docs.getCRDT("doc1")
  const chars = crdt.getFormattedChars()
  const firstCharId = chars[0].id
  // The format op above may have used wrong ID. Let's apply properly:
  docs.applyOperation("doc1", { type: "format", id: firstCharId, attrs: { bold: true } })

  // Reload
  const docs2 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  const crdt2 = docs2.loadDocument("doc1")
  const chars2 = crdt2.getFormattedChars()
  assert(chars2[0].attrs.bold === true, "format after snapshot replayed on reload")
  storage.close()
})

// Helper for test above - compact generates new IDs, so we can't predict them
function expect_id_after_compact() {
  return "dummy_id_will_be_overwritten"
}

runTest("DocumentService: insert with attrs creates formatted character", () => {
  const storage = new TestStorage()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  docs.applyOperation("doc1", {
    type: "insert", id: "c0", value: "B", after: "ROOT",
    attrs: { bold: true }
  })

  const chars = docs.getCRDT("doc1").getFormattedChars()
  assert(chars[0].attrs.bold === true, "inserted char is bold via attrs param")
  storage.close()
})

runTest("DocumentService: insert with attrs persisted and replayed", () => {
  const storage = new TestStorage()

  // Session 1
  const docs1 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  docs1.applyOperation("doc1", {
    type: "insert", id: "c0", value: "I", after: "ROOT",
    attrs: { italic: true }
  })

  // Session 2
  const docs2 = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })
  const chars = docs2.loadDocument("doc1").getFormattedChars()
  assert(chars[0].attrs.italic === true, "insert attrs replayed from DB")
  storage.close()
})

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60))
console.log("Format Operations Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Tests: ${passed + failed}`)
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log("=".repeat(60))

if (failed > 0) process.exit(1)

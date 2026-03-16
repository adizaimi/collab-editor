/**
 * Stress test: bulk paste on a slow server with limited memory
 *
 * Simulates:
 *  - Large paste (5000 chars)
 *  - Constrained queue (maxQueueSize: 200)
 *  - Artificially slow DB writes (50ms per batch)
 *  - Memory tracking before/after
 */

const SQLiteStorage = require('../../server/storage/sqlite')
const DocumentService = require('../../server/services/document')
const CRDTText = require('../../server/crdt/text')
const path = require('path')
const fs = require('fs')

const DB_PATH = path.join(__dirname, 'bulk-paste-stress.db')
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)

// ── helpers ──────────────────────────────────────────────

function memMB() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg)
}

// ── slow storage wrapper ─────────────────────────────────
// Wraps real SQLiteStorage, adds artificial latency to writes

class SlowStorage {
  constructor(realStorage, writeDelay = 50) {
    this.real = realStorage
    this.writeDelay = writeDelay
    this.writeCount = 0
    this.batchCount = 0
  }

  init()                          { return this.real.init() }
  loadOperations(docId)           { return this.real.loadOperations(docId) }
  loadLatestSnapshot(docId)       { return this.real.loadLatestSnapshot(docId) }
  loadOperationsSinceSnapshot(a,b){ return this.real.loadOperationsSinceSnapshot(a,b) }
  deleteOldOperations(a,b)        { return this.real.deleteOldOperations(a,b) }
  getOperationCount(docId)        { return this.real.getOperationCount(docId) }
  listDocuments()                 { return this.real.listDocuments() }
  saveSnapshot(a,b,c)             { return this.real.saveSnapshot(a,b,c) }
  close()                         { return this.real.close() }

  saveOperation(docId, op) {
    this.writeCount++
    // simulate slow disk
    const start = Date.now()
    while (Date.now() - start < this.writeDelay) { /* busy-wait */ }
    return this.real.saveOperation(docId, op)
  }

  saveOperationBatch(docId, ops) {
    this.batchCount++
    const start = Date.now()
    while (Date.now() - start < this.writeDelay) { /* busy-wait */ }
    return this.real.saveOperationBatch(docId, ops)
  }
}

// ── simulate the server insert path ──────────────────────

function simulateOldPaste(docs, docId, text, clientId) {
  const crdt = docs.getCRDT(docId)
  const chars = Array.from(text)
  const attrs = null

  let afterId = crdt.getText().length === 0 ? 'ROOT' : crdt.getIdAtOffset(crdt.getText().length - 1)
  let warnings = 0

  const origWarn = console.warn
  console.warn = (...args) => {
    if (args[0] && args[0].includes && args[0].includes('Queue full')) warnings++
    origWarn.apply(console, args)
  }

  for (let i = 0; i < chars.length; i++) {
    const id = `${clientId}:old:${Date.now()}:${Math.random()}`
    const op = { type: 'insert', id, value: chars[i], after: afterId, attrs }
    docs.applyOperationWithBatching(docId, op, clientId)
    afterId = id
  }

  console.warn = origWarn
  return { warnings }
}

function simulateNewPaste(docs, docId, text, clientId) {
  const crdt = docs.getCRDT(docId)
  const chars = Array.from(text)
  const attrs = null

  let afterId = crdt.getText().length === 0 ? 'ROOT' : crdt.getIdAtOffset(crdt.getText().length - 1)

  const ops = []
  for (let i = 0; i < chars.length; i++) {
    const id = `${clientId}:new:${Date.now()}:${Math.random()}`
    ops.push({ type: 'insert', id, value: chars[i], after: afterId, attrs })
    afterId = id
  }

  let warnings = 0
  const origWarn = console.warn
  console.warn = (...args) => {
    if (args[0] && args[0].includes && args[0].includes('Queue full')) warnings++
    origWarn.apply(console, args)
  }

  if (ops.length === 1) {
    docs.applyOperationWithBatching(docId, ops[0], clientId)
  } else {
    docs.applyBulkInsert(docId, ops, clientId)
  }

  console.warn = origWarn
  return { warnings }
}

// ── run ──────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('STRESS TEST: Bulk paste on slow server')
  console.log('='.repeat(60))

  const realStorage = new SQLiteStorage()
  realStorage.db = require('better-sqlite3')(DB_PATH)
  realStorage.init()

  const slowStorage = new SlowStorage(realStorage, 50)

  const docs = new DocumentService(slowStorage, {
    useAsyncQueue: true,
    queueOptions: {
      flushInterval: 500,
      maxBatchSize: 100,
      maxQueueSize: 200   // small queue to trigger the problem
    }
  })

  // pre-load document
  docs.loadDocument('test')

  const pasteText = 'A'.repeat(2000) + '\n' + 'B'.repeat(2000) + '\n' + 'C'.repeat(1000)
  console.log(`\nPaste size: ${pasteText.length} chars`)
  console.log(`Queue limit: 200`)

  // ── OLD path (per-char queue) ──────────────────────────
  console.log(`\n--- OLD path (per-char enqueue) ---`)
  console.log(`Heap before: ${memMB()} MB`)

  const t0 = Date.now()
  const old = simulateOldPaste(docs, 'test-old', pasteText, 'client1')
  const elapsed0 = Date.now() - t0

  console.log(`Elapsed: ${elapsed0} ms`)
  console.log(`Queue-full warnings: ${old.warnings}`)
  console.log(`Slow-storage writes: ${slowStorage.writeCount} individual, ${slowStorage.batchCount} batch`)
  console.log(`Heap after: ${memMB()} MB`)

  await docs.flushBuffers()
  const oldText = docs.getText('test-old')
  assert(oldText === pasteText, `old path: content mismatch (${oldText.length} vs ${pasteText.length})`)

  // reset counters
  const prevWrites = slowStorage.writeCount
  const prevBatches = slowStorage.batchCount

  // ── NEW path (bulk insert) ─────────────────────────────
  console.log(`\n--- NEW path (applyBulkInsert) ---`)
  console.log(`Heap before: ${memMB()} MB`)

  const t1 = Date.now()
  const nw = simulateNewPaste(docs, 'test-new', pasteText, 'client1')
  const elapsed1 = Date.now() - t1

  const newWrites = slowStorage.writeCount - prevWrites
  const newBatches = slowStorage.batchCount - prevBatches

  console.log(`Elapsed: ${elapsed1} ms`)
  console.log(`Queue-full warnings: ${nw.warnings}`)
  console.log(`Slow-storage writes: ${newWrites} individual, ${newBatches} batch`)
  console.log(`Heap after: ${memMB()} MB`)

  const newText = docs.getText('test-new')
  assert(newText === pasteText, `new path: content mismatch (${newText.length} vs ${pasteText.length})`)

  // ── verdict ────────────────────────────────────────────
  console.log(`\n--- Comparison ---`)
  console.log(`OLD: ${elapsed0} ms, ${old.warnings} queue-full warnings`)
  console.log(`NEW: ${elapsed1} ms, ${nw.warnings} queue-full warnings`)
  const speedup = (elapsed0 / elapsed1).toFixed(1)
  console.log(`Speedup: ${speedup}x`)

  const pass = nw.warnings === 0
  if (pass) {
    console.log('\n✅ Bulk insert bypasses queue — no warnings, single batch write')
  } else {
    console.log(`\n❌ Still got ${nw.warnings} queue-full warnings`)
  }

  // cleanup
  docs.buffer && docs.buffer.stop && docs.buffer.stop()
  realStorage.close()
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)

  console.log('\n' + '='.repeat(60))
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })

/**
 * E2E Test: Documents API
 *
 * Tests the GET /api/documents endpoint that lists all documents
 * in the database with their last-updated timestamps.
 */

const http = require("http")
const express = require("express")
const Database = require("better-sqlite3")
const SQLiteStorage = require("../../server/storage/sqlite")
const DocumentService = require("../../server/services/document")
const fs = require("fs")
const path = require("path")

let passedTests = 0
let failedTests = 0
const testDbPath = path.join(__dirname, "docapi-test.db")
const TEST_PORT = 3005

function assert(condition, message) {
  if (!condition) {
    console.log(`  ❌ FAILED: ${message}`)
    failedTests++
    return false
  }
  console.log(`  ✅ PASSED: ${message}`)
  passedTests++
  return true
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanup() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = testDbPath + ext
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

function fetchJSON(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${urlPath}`, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Invalid JSON: ' + data)) }
      })
    }).on('error', reject)
  })
}

function createTestServer() {
  const storage = new SQLiteStorage()
  storage.db = new Database(testDbPath)
  storage.init()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  const app = express()

  // Replicate the /api/documents endpoint from server.js
  app.get('/api/documents', (req, res) => {
    const docsList = storage.listDocuments()
    const result = docsList.map(d => ({
      id: d.doc_id,
      lastUpdated: d.last_updated,
      activeUsers: 0
    }))
    res.json(result)
  })

  const server = http.createServer(app)
  return { server, storage, docs }
}

async function runTests() {
  cleanup()
  const { server, storage, docs } = createTestServer()

  await new Promise(resolve => server.listen(TEST_PORT, resolve))
  console.log(`\nDocuments API E2E Test Server running on port ${TEST_PORT}\n`)

  let testNum = 0
  function test(name) { testNum++; console.log(`\n[Test ${testNum}] ${name}`) }

  try {
    // --- Test 1: Empty database returns empty array ---
    test("Empty database returns empty array")
    const emptyResult = await fetchJSON('/api/documents')
    assert(Array.isArray(emptyResult), "response is an array")
    assert(emptyResult.length === 0, "empty database returns no documents")

    // --- Test 2: Single document appears after operations ---
    test("Single document appears after inserting operations")
    docs.applyOperation("test-doc", { type: "insert", id: "c0", value: "a", after: "ROOT" })
    const oneDoc = await fetchJSON('/api/documents')
    assert(oneDoc.length === 1, "one document listed")
    assert(oneDoc[0].id === "test-doc", "document id correct")
    assert(typeof oneDoc[0].lastUpdated === 'number', "lastUpdated is a number")
    assert(oneDoc[0].lastUpdated > 0, "lastUpdated is positive")
    assert(oneDoc[0].activeUsers === 0, "activeUsers is 0 (no WebSocket connections)")

    // --- Test 3: Multiple documents ---
    test("Multiple documents listed")
    docs.applyOperation("doc-alpha", { type: "insert", id: "c1", value: "x", after: "ROOT" })
    docs.applyOperation("doc-beta", { type: "insert", id: "c2", value: "y", after: "ROOT" })
    const multiDocs = await fetchJSON('/api/documents')
    assert(multiDocs.length === 3, "three documents listed")
    const ids = multiDocs.map(d => d.id).sort()
    assert(ids.includes("test-doc"), "test-doc in list")
    assert(ids.includes("doc-alpha"), "doc-alpha in list")
    assert(ids.includes("doc-beta"), "doc-beta in list")

    // --- Test 4: Ordering by most recently updated ---
    test("Documents ordered by most recently updated")
    // doc-beta was the last one we inserted into, so it should be first
    assert(multiDocs[0].lastUpdated >= multiDocs[1].lastUpdated, "first doc has latest timestamp")
    assert(multiDocs[1].lastUpdated >= multiDocs[2].lastUpdated, "second doc not older than third")

    // --- Test 5: Documents with only snapshots appear ---
    test("Documents with only snapshots appear in list")
    await docs.createSnapshot("test-doc")
    // After snapshot, operations are archived but snapshot remains
    const afterSnap = await fetchJSON('/api/documents')
    const snapDocIds = afterSnap.map(d => d.id)
    assert(snapDocIds.includes("test-doc"), "test-doc still listed after snapshot archived ops")

    // --- Test 6: Response shape ---
    test("Response has correct shape for each document")
    const shapeDocs = await fetchJSON('/api/documents')
    for (const doc of shapeDocs) {
      assert(typeof doc.id === 'string', "id is a string for doc " + doc.id)
      assert(typeof doc.lastUpdated === 'number', "lastUpdated is a number for doc " + doc.id)
      assert(typeof doc.activeUsers === 'number', "activeUsers is a number for doc " + doc.id)
    }

    // --- Test 7: Many documents ---
    test("Handles many documents")
    for (let i = 0; i < 20; i++) {
      docs.applyOperation("bulk-" + i, { type: "insert", id: "b" + i, value: "z", after: "ROOT" })
    }
    const manyDocs = await fetchJSON('/api/documents')
    assert(manyDocs.length === 23, "23 documents (3 original + 20 bulk)")

    // --- Test 8: Document with multiple operations listed once ---
    test("Document with multiple operations listed only once")
    docs.applyOperation("multi-op", { type: "insert", id: "m0", value: "a", after: "ROOT" })
    docs.applyOperation("multi-op", { type: "insert", id: "m1", value: "b", after: "m0" })
    docs.applyOperation("multi-op", { type: "insert", id: "m2", value: "c", after: "m1" })
    const dedup = await fetchJSON('/api/documents')
    const multiOpCount = dedup.filter(d => d.id === "multi-op").length
    assert(multiOpCount === 1, "multi-op appears exactly once despite 3 operations")

  } finally {
    server.close()
    storage.close()
    cleanup()
  }

  console.log("\n" + "=".repeat(60))
  console.log("Documents API E2E Tests Summary")
  console.log("=".repeat(60))
  console.log(`Total Assertions: ${passedTests + failedTests}`)
  console.log(`✅ Passed: ${passedTests}`)
  console.log(`❌ Failed: ${failedTests}`)
  console.log("=".repeat(60))

  if (failedTests > 0) process.exit(1)
}

runTests().catch(err => {
  console.error("Test error:", err)
  process.exit(1)
})

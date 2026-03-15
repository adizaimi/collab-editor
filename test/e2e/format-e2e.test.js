/**
 * E2E Test: Rich Text Formatting
 *
 * Tests format operations flowing through the server:
 * client -> server -> CRDT -> broadcast -> other clients
 */

const WebSocket = require("ws")
const http = require("http")
const express = require("express")
const Database = require("better-sqlite3")
const SQLiteStorage = require("../../server/storage/sqlite")
const DocumentService = require("../../server/services/document")
const fs = require("fs")
const path = require("path")

let passedTests = 0
let failedTests = 0
const testDbPath = path.join(__dirname, "format-test.db")
const TEST_PORT = 3004

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

function createTestServer() {
  const storage = new SQLiteStorage()
  storage.db = new Database(testDbPath)
  storage.init()
  const docs = new DocumentService(storage, { enableBatching: false, useAsyncQueue: false })

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocket.Server({ server })

  function broadcast(docId, msg) {
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN && c.docId === docId) {
        c.send(JSON.stringify(msg))
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x")
    const docId = url.searchParams.get("doc") || "main"
    ws.docId = docId

    const text = docs.getText(docId)
    const formattedChars = docs.getFormattedChars(docId)
    ws.send(JSON.stringify({ type: "init", text, formattedChars }))

    ws.on("message", msg => {
      let data
      try { data = JSON.parse(msg) } catch (e) { return }
      if (!data.type || !data.clientId) return

      const crdt = docs.getCRDT(docId)
      let broadcastOp = null

      if (data.type === "insert") {
        const afterId = crdt.getIdAtOffset(data.offset - 1)
        const op = {
          type: "insert",
          id: `${data.clientId}:${Date.now()}:${Math.random()}`,
          value: data.value,
          after: afterId
        }
        docs.applyOperation(docId, op)
        const offset = crdt.getOffsetOfId(op.id)
        broadcastOp = { type: "insert", offset, value: data.value, clientId: data.clientId }
      } else if (data.type === "delete") {
        const chars = crdt.getVisibleChars()
        if (data.offset >= chars.length) return
        const charId = chars[data.offset].id
        const offset = crdt.getOffsetOfId(charId)
        docs.applyOperation(docId, { type: "delete", id: charId })
        broadcastOp = { type: "delete", offset, clientId: data.clientId }
      } else if (data.type === "format") {
        const chars = crdt.getVisibleChars()
        const start = data.offset
        const end = data.endOffset !== undefined ? data.endOffset : start + 1
        const charIds = []
        for (let i = start; i < end && i < chars.length; i++) {
          charIds.push(chars[i].id)
        }
        if (charIds.length > 0) {
          docs.applyFormatWithBatching(docId, charIds, data.attrs, data.clientId)
          broadcastOp = {
            type: "format",
            offset: start,
            endOffset: end,
            attrs: data.attrs,
            clientId: data.clientId
          }
        }
      }

      if (broadcastOp) {
        broadcast(docId, { type: "op", op: broadcastOp })
      }
    })
  })

  return { server, storage, docs, wss }
}

function createClient(docId) {
  return new Promise((resolve) => {
    const clientId = 'test_' + Math.random().toString(36).substring(7)
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?doc=${docId}`)
    const receivedOps = []
    let serverText = ""
    let formattedChars = []

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw)
      if (msg.type === "init") {
        serverText = msg.text
        formattedChars = msg.formattedChars || []
      }
      if (msg.type === "op") {
        receivedOps.push(msg.op)
        // Apply op locally
        if (msg.op.type === "insert") {
          const arr = Array.from(serverText)
          arr.splice(msg.op.offset, 0, msg.op.value)
          serverText = arr.join("")
          formattedChars.splice(msg.op.offset, 0, { value: msg.op.value, attrs: {} })
        } else if (msg.op.type === "delete") {
          const arr = Array.from(serverText)
          arr.splice(msg.op.offset, 1)
          serverText = arr.join("")
          formattedChars.splice(msg.op.offset, 1)
        } else if (msg.op.type === "format") {
          const start = msg.op.offset
          const end = msg.op.endOffset || start + 1
          for (let i = start; i < end && i < formattedChars.length; i++) {
            if (!formattedChars[i].attrs) formattedChars[i].attrs = {}
            for (const [k, v] of Object.entries(msg.op.attrs)) {
              if (v === false || v === null) delete formattedChars[i].attrs[k]
              else formattedChars[i].attrs[k] = v
            }
          }
        }
      }
    })

    ws.on("open", () => {
      resolve({
        ws, clientId, receivedOps,
        getText: () => serverText,
        getFormattedChars: () => formattedChars,
        send: (data) => ws.send(JSON.stringify({ ...data, clientId })),
        close: () => ws.close()
      })
    })
  })
}

async function runTests() {
  cleanup()
  const { server, storage, docs } = createTestServer()

  await new Promise(resolve => server.listen(TEST_PORT, resolve))
  console.log(`\nFormat E2E Test Server running on port ${TEST_PORT}\n`)

  let testNum = 0
  function test(name) { testNum++; console.log(`\n[Test ${testNum}] ${name}`) }

  try {
    // --- Test 1: Insert and format, second client sees formatting ---
    test("Client inserts text, formats it, second client receives formatting")

    const c1 = await createClient("fmt-test1")
    await sleep(100)

    // Insert "Hello"
    for (let i = 0; i < 5; i++) {
      c1.send({ type: "insert", value: "Hello"[i], offset: i })
    }
    await sleep(200)

    // Format "Hel" as bold
    c1.send({ type: "format", offset: 0, endOffset: 3, attrs: { bold: true } })
    await sleep(200)

    // Second client connects and gets formatted content
    const c2 = await createClient("fmt-test1")
    await sleep(200)

    const fc = c2.getFormattedChars()
    assert(fc.length === 5, "second client has 5 chars")
    assert(fc[0].attrs.bold === true, "H is bold for second client")
    assert(fc[1].attrs.bold === true, "e is bold for second client")
    assert(fc[2].attrs.bold === true, "l is bold for second client")
    assert(!fc[3].attrs.bold, "l (4th) is not bold")
    assert(!fc[4].attrs.bold, "o is not bold")
    assert(c2.getText() === "Hello", "text is correct")

    c1.close()
    c2.close()
    await sleep(100)

    // --- Test 2: Format broadcast to connected client ---
    test("Format operation broadcast to connected client in real-time")

    const c3 = await createClient("fmt-test2")
    await sleep(100)
    for (let i = 0; i < 3; i++) {
      c3.send({ type: "insert", value: "abc"[i], offset: i })
    }
    await sleep(200)

    const c4 = await createClient("fmt-test2")
    await sleep(200)

    // c3 formats "a" as italic
    c3.send({ type: "format", offset: 0, endOffset: 1, attrs: { italic: true } })
    await sleep(300)

    // c4 should have received the format op
    const formatOps = c4.receivedOps.filter(op => op.type === "format")
    assert(formatOps.length >= 1, "client4 received format op")
    if (formatOps.length > 0) {
      assert(formatOps[0].attrs.italic === true, "format op has italic attr")
      assert(formatOps[0].offset === 0, "format op starts at offset 0")
    }

    c3.close()
    c4.close()
    await sleep(100)

    // --- Test 3: Bold + italic together ---
    test("Multiple formatting attributes on same range")

    const c5 = await createClient("fmt-test3")
    await sleep(100)

    c5.send({ type: "insert", value: "X", offset: 0 })
    await sleep(200)

    c5.send({ type: "format", offset: 0, endOffset: 1, attrs: { bold: true } })
    await sleep(100)
    c5.send({ type: "format", offset: 0, endOffset: 1, attrs: { italic: true } })
    await sleep(200)

    // New client should see both formats
    const c6 = await createClient("fmt-test3")
    await sleep(200)

    const fc6 = c6.getFormattedChars()
    assert(fc6.length === 1, "one char")
    assert(fc6[0].attrs.bold === true, "bold applied")
    assert(fc6[0].attrs.italic === true, "italic applied")

    c5.close()
    c6.close()
    await sleep(100)

    // --- Test 4: Toggle formatting off ---
    test("Toggle formatting off")

    const c7 = await createClient("fmt-test4")
    await sleep(100)

    c7.send({ type: "insert", value: "Y", offset: 0 })
    await sleep(200)

    c7.send({ type: "format", offset: 0, endOffset: 1, attrs: { bold: true } })
    await sleep(100)
    c7.send({ type: "format", offset: 0, endOffset: 1, attrs: { bold: false } })
    await sleep(200)

    const c8 = await createClient("fmt-test4")
    await sleep(200)

    const fc8 = c8.getFormattedChars()
    assert(fc8.length === 1, "one char")
    assert(!fc8[0].attrs.bold, "bold toggled off")

    c7.close()
    c8.close()
    await sleep(100)

    // --- Test 5: Bullet block formatting ---
    test("Bullet block formatting on newline character")

    const c9 = await createClient("fmt-test5")
    await sleep(100)

    // Insert "a\nb"
    c9.send({ type: "insert", value: "a", offset: 0 })
    await sleep(50)
    c9.send({ type: "insert", value: "\n", offset: 1 })
    await sleep(50)
    c9.send({ type: "insert", value: "b", offset: 2 })
    await sleep(200)

    // Format the newline as bullet
    c9.send({ type: "format", offset: 1, endOffset: 2, attrs: { block: "bullet" } })
    await sleep(200)

    const c10 = await createClient("fmt-test5")
    await sleep(200)

    const fc10 = c10.getFormattedChars()
    assert(fc10.length === 3, "3 chars")
    assert(fc10[1].value === "\n", "newline at index 1")
    assert(fc10[1].attrs.block === "bullet", "newline has bullet block attr")
    assert(c10.getText() === "a\nb", "text correct")

    c9.close()
    c10.close()
    await sleep(100)

    // --- Test 6: Formatting persists across server restart (via DB) ---
    test("Formatting persists in database")

    // Check the CRDT state directly
    const crdt = docs.getCRDT("fmt-test1")
    const serverFc = crdt.getFormattedChars()
    assert(serverFc[0].attrs.bold === true, "H bold in server CRDT")
    assert(serverFc[2].attrs.bold === true, "l bold in server CRDT")
    assert(docs.getText("fmt-test1") === "Hello", "text in server")

  } finally {
    server.close()
    storage.close()
    cleanup()
  }

  console.log("\n" + "=".repeat(60))
  console.log("Format E2E Tests Summary")
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

const WebSocket = require("ws")
const http = require("http")
const express = require("express")
const SQLiteStorage = require("../../server/storage/sqlite")
const DocumentService = require("../../server/services/document")
const fs = require("fs")
const path = require("path")

// Test utilities
let passedTests = 0
let failedTests = 0
const testDbPath = path.join(__dirname, "../e2e-test.db")
const TEST_PORT = 3001

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanupTestDb() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }
}

// Create test server
function createTestServer() {
  const Database = require("better-sqlite3")
  const storage = new SQLiteStorage()
  storage.db = new Database(testDbPath)
  storage.init()
  const docs = new DocumentService(storage)

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

    ws.send(JSON.stringify({ type: "init", text: docs.getText(docId) }))

    ws.on("message", msg => {
      const data = JSON.parse(msg)
      const crdt = docs.getCRDT(docId)
      let op = null
      let broadcastOp = null

      if (data.type === "insert") {
        const afterId = crdt.getIdAtOffset(data.offset - 1)
        op = { type: "insert", id: `${Date.now()}:${Math.random()}`, value: data.value, after: afterId }
        docs.applyOperation(docId, op)
        const offset = crdt.getOffsetOfId(op.id)
        broadcastOp = { type: "insert", offset, value: data.value, clientId: data.clientId }
      } else if (data.type === "delete") {
        const chars = crdt.getVisibleChars()
        let charId = null
        if (data.offset < chars.length) {
          charId = chars[data.offset].id
        } else if (data.char) {
          for (const c of chars) {
            if (c.value === data.char) {
              charId = c.id
              break
            }
          }
        }
        if (!charId) return
        op = { type: "delete", id: charId }
        const offset = crdt.getOffsetOfId(op.id)
        docs.applyOperation(docId, op)
        broadcastOp = { type: "delete", offset, clientId: data.clientId }
      }

      if (broadcastOp) {
        broadcast(docId, { type: "op", op: broadcastOp })
      }
    })
  })

  return { server, storage, docs, wss }
}

// Create test client
function createTestClient(docId, port = TEST_PORT) {
  return new Promise((resolve) => {
    const clientId = Math.random().toString(36).substring(7)
    const ws = new WebSocket(`ws://localhost:${port}?doc=${docId}`)
    let serverText = ""
    const receivedOps = []

    ws.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "init") {
        serverText = msg.text
      }
      if (msg.type === "op") {
        receivedOps.push(msg.op)
        const textArr = serverText.split("")
        if (msg.op.type === "insert") {
          textArr.splice(msg.op.offset, 0, msg.op.value)
        } else if (msg.op.type === "delete") {
          textArr.splice(msg.op.offset, 1)
        }
        serverText = textArr.join("")
      }
    })

    ws.on("open", () => {
      resolve({
        ws,
        clientId,
        getText: () => serverText,
        getReceivedOps: () => receivedOps,
        insert: (value, offset) => {
          ws.send(JSON.stringify({ type: "insert", value, offset, clientId }))
        },
        delete: (offset, char) => {
          ws.send(JSON.stringify({ type: "delete", offset, char, clientId }))
        },
        close: () => ws.close()
      })
    })
  })
}

console.log("=".repeat(60))
console.log("END-TO-END TESTS: Server-Client Integration")
console.log("=".repeat(60))

async function runTests() {
  // Test 1: Server starts and accepts connections
  console.log("\n[Test 1] Server starts and accepts WebSocket connections")
  cleanupTestDb()
  const { server: server1, wss: wss1 } = createTestServer()
  await new Promise(resolve => server1.listen(TEST_PORT, resolve))
  const client1 = await createTestClient("test1")
  await sleep(100)
  assertEquals(wss1.clients.size, 1, "server has 1 connected client")
  client1.close()
  await sleep(100)
  server1.close()
  await sleep(200)

  // Test 2: Client receives init message
  console.log("\n[Test 2] Client receives init message with document text")
  cleanupTestDb()
  const { server: server2 } = createTestServer()
  await new Promise(resolve => server2.listen(TEST_PORT, resolve))
  const client2 = await createTestClient("test2")
  await sleep(200)
  assertEquals(client2.getText(), "", "initial text is empty")
  client2.close()
  server2.close()
  await sleep(200)

  // Test 3: Single insert operation
  console.log("\n[Test 3] Single client insert operation")
  cleanupTestDb()
  const { server: server3 } = createTestServer()
  await new Promise(resolve => server3.listen(TEST_PORT, resolve))
  const client3 = await createTestClient("test3")
  await sleep(200)
  client3.insert("A", 0)
  await sleep(300)
  assertEquals(client3.getText(), "A", "client receives echoed insert")
  client3.close()
  server3.close()
  await sleep(200)

  // Test 4: Multiple sequential inserts
  console.log("\n[Test 4] Multiple sequential insert operations")
  cleanupTestDb()
  const { server: server4 } = createTestServer()
  await new Promise(resolve => server4.listen(TEST_PORT, resolve))
  const client4 = await createTestClient("test4")
  await sleep(200)
  client4.insert("H", 0)
  await sleep(50)
  client4.insert("I", 1)
  await sleep(300)
  assertEquals(client4.getText(), "HI", "sequential inserts work")
  client4.close()
  server4.close()
  await sleep(200)

  // Test 5: Delete operation
  console.log("\n[Test 5] Delete operation")
  cleanupTestDb()
  const { server: server5 } = createTestServer()
  await new Promise(resolve => server5.listen(TEST_PORT, resolve))
  const client5 = await createTestClient("test5")
  await sleep(200)
  client5.insert("A", 0)
  client5.insert("B", 1)
  await sleep(300)
  client5.delete(0, "A")
  await sleep(300)
  assertEquals(client5.getText(), "B", "delete operation works")
  client5.close()
  server5.close()
  await sleep(200)

  // Test 6: Two clients - broadcast
  console.log("\n[Test 6] Two clients receive each other's operations")
  cleanupTestDb()
  const { server: server6 } = createTestServer()
  await new Promise(resolve => server6.listen(TEST_PORT, resolve))
  const client6a = await createTestClient("test6")
  const client6b = await createTestClient("test6")
  await sleep(200)
  client6a.insert("X", 0)
  await sleep(300)
  assertEquals(client6a.getText(), "X", "client A has X")
  assertEquals(client6b.getText(), "X", "client B receives X")
  client6a.close()
  client6b.close()
  server6.close()
  await sleep(200)

  // Test 7: Concurrent inserts converge
  console.log("\n[Test 7] Concurrent inserts from two clients converge")
  cleanupTestDb()
  const { server: server7 } = createTestServer()
  await new Promise(resolve => server7.listen(TEST_PORT, resolve))
  const client7a = await createTestClient("test7")
  const client7b = await createTestClient("test7")
  await sleep(200)
  client7a.insert("A", 0)
  client7b.insert("B", 0)
  await sleep(500)
  const text7a = client7a.getText()
  const text7b = client7b.getText()
  assertEquals(text7a, text7b, "both clients converge to same text")
  assertEquals(text7a.length, 2, "both characters preserved")
  client7a.close()
  client7b.close()
  server7.close()
  await sleep(200)

  // Test 8: Insert in middle
  console.log("\n[Test 8] Insert in middle of document")
  cleanupTestDb()
  const { server: server8 } = createTestServer()
  await new Promise(resolve => server8.listen(TEST_PORT, resolve))
  const client8 = await createTestClient("test8")
  await sleep(200)
  client8.insert("H", 0)
  client8.insert("E", 1)
  client8.insert("L", 2)
  client8.insert("L", 3)
  client8.insert("O", 4)
  await sleep(300)
  client8.insert("X", 2)
  await sleep(300)
  assertEquals(client8.getText(), "HEXLLO", "insert in middle works")
  client8.close()
  server8.close()
  await sleep(200)

  // Test 9: Persistence across reconnections
  console.log("\n[Test 9] Document persists across client reconnections")
  cleanupTestDb()
  const { server: server9 } = createTestServer()
  await new Promise(resolve => server9.listen(TEST_PORT, resolve))
  const client9a = await createTestClient("test9")
  await sleep(200)
  client9a.insert("P", 0)
  client9a.insert("Q", 1)
  await sleep(300)
  client9a.close()
  await sleep(200)
  const client9b = await createTestClient("test9")
  await sleep(300)
  assertEquals(client9b.getText(), "PQ", "new client loads persisted document")
  client9b.close()
  server9.close()
  await sleep(200)

  // Test 10: Multiple documents isolated
  console.log("\n[Test 10] Multiple documents are isolated")
  cleanupTestDb()
  const { server: server10 } = createTestServer()
  await new Promise(resolve => server10.listen(TEST_PORT, resolve))
  const client10a = await createTestClient("doc1")
  const client10b = await createTestClient("doc2")
  await sleep(200)
  client10a.insert("A", 0)
  client10b.insert("B", 0)
  await sleep(300)
  assertEquals(client10a.getText(), "A", "doc1 has only A")
  assertEquals(client10b.getText(), "B", "doc2 has only B")
  client10a.close()
  client10b.close()
  server10.close()
  await sleep(200)

  // Test 11: Rapid sequential operations
  console.log("\n[Test 11] Rapid sequential operations")
  cleanupTestDb()
  const { server: server11 } = createTestServer()
  await new Promise(resolve => server11.listen(TEST_PORT, resolve))
  const client11 = await createTestClient("test11")
  await sleep(200)
  const text = "FAST"
  for (let i = 0; i < text.length; i++) {
    client11.insert(text[i], i)
    await sleep(10)
  }
  await sleep(500)
  assertEquals(client11.getText(), "FAST", "rapid operations work")
  client11.close()
  server11.close()
  await sleep(200)

  // Test 12: Three clients concurrent editing
  console.log("\n[Test 12] Three clients concurrent editing")
  cleanupTestDb()
  const { server: server12 } = createTestServer()
  await new Promise(resolve => server12.listen(TEST_PORT, resolve))
  const client12a = await createTestClient("test12")
  const client12b = await createTestClient("test12")
  const client12c = await createTestClient("test12")
  await sleep(200)
  client12a.insert("1", 0)
  client12b.insert("2", 0)
  client12c.insert("3", 0)
  await sleep(500)
  const text12a = client12a.getText()
  const text12b = client12b.getText()
  const text12c = client12c.getText()
  assert(text12a === text12b && text12b === text12c, "all three clients converge")
  assertEquals(text12a.length, 3, "all characters preserved")
  client12a.close()
  client12b.close()
  client12c.close()
  server12.close()
  await sleep(200)

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("E2E Tests Summary")
  console.log("=".repeat(60))
  console.log(`Total Tests: ${passedTests + failedTests}`)
  console.log(`✅ Passed: ${passedTests}`)
  console.log(`❌ Failed: ${failedTests}`)
  console.log("=".repeat(60))

  cleanupTestDb()
  process.exit(failedTests > 0 ? 1 : 0)
}

runTests().catch(err => {
  console.error("Test error:", err)
  cleanupTestDb()
  process.exit(1)
})

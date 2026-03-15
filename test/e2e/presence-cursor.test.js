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
const testDbPath = path.join(__dirname, "../presence-test.db")
const TEST_PORT = 3002

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

function assertIncludes(arr, value, message) {
  const passed = arr.includes(value)
  if (!passed) {
    console.log(`  ❌ FAILED: ${message}`)
    console.log(`     Array: ${JSON.stringify(arr)}`)
    console.log(`     Expected to include: ${JSON.stringify(value)}`)
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
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
}

// Color pool (must match server/server.js)
const USER_COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA',
  '#00ACC1', '#D81B60', '#3949AB', '#7CB342', '#F4511E',
  '#039BE5', '#C0CA33', '#5E35B1', '#00897B', '#FFB300',
  '#6D4C41', '#546E7A', '#EC407A', '#26A69A', '#AB47BC'
]

// Create a test server with full presence/cursor support
function createTestServer() {
  const Database = require("better-sqlite3")
  const storage = new SQLiteStorage()
  storage.db = new Database(testDbPath)
  storage.init()
  const docs = new DocumentService(storage)

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocket.Server({ server })

  const docUsers = new Map()
  let userCounter = 0

  function assignUserId() {
    userCounter++
    return `user${userCounter}`
  }

  function assignColor(docId) {
    const usedColors = new Set()
    const users = docUsers.get(docId)
    if (users) {
      for (const ws of users.values()) {
        if (ws.color) usedColors.add(ws.color)
      }
    }
    for (const color of USER_COLORS) {
      if (!usedColors.has(color)) return color
    }
    return USER_COLORS[userCounter % USER_COLORS.length]
  }

  function getUsersForDoc(docId) {
    const users = docUsers.get(docId)
    if (!users) return []
    return Array.from(users.entries()).map(([id, ws]) => ({
      id,
      color: ws.color,
      cursor: ws.cursor
    }))
  }

  function broadcast(docId, msg) {
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN && c.docId === docId) {
        c.send(JSON.stringify(msg))
      }
    }
  }

  function broadcastUsers(docId) {
    broadcast(docId, { type: "users", users: getUsersForDoc(docId) })
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x")
    const docId = url.searchParams.get("doc") || "main"
    const userId = assignUserId()
    const color = assignColor(docId)
    ws.docId = docId
    ws.userId = userId
    ws.color = color
    ws.cursor = { offset: 0, selEnd: 0 }

    if (!docUsers.has(docId)) docUsers.set(docId, new Map())
    docUsers.get(docId).set(userId, ws)

    const text = docs.getText(docId)
    ws.send(JSON.stringify({ type: "init", text, userId, color, users: getUsersForDoc(docId) }))

    broadcastUsers(docId)

    ws.on("message", raw => {
      let data
      try { data = JSON.parse(raw) } catch { return }
      if (!data.type || !data.clientId) return

      if (data.type === "cursor") {
        ws.cursor = { offset: data.offset || 0, selEnd: data.selEnd || 0 }
        for (const c of wss.clients) {
          if (c !== ws && c.readyState === WebSocket.OPEN && c.docId === docId) {
            c.send(JSON.stringify({
              type: "cursor",
              userId: ws.userId,
              color: ws.color,
              offset: ws.cursor.offset,
              selEnd: ws.cursor.selEnd
            }))
          }
        }
        return
      }

      const crdt = docs.getCRDT(docId)
      let broadcastOp = null

      if (data.type === "insert") {
        const afterId = crdt.getIdAtOffset(data.offset - 1)
        const op = { type: "insert", id: `${data.clientId}:${Date.now()}:${Math.random()}`, value: data.value, after: afterId }
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
      }

      if (broadcastOp) broadcast(docId, { type: "op", op: broadcastOp })
    })

    ws.on("close", () => {
      const users = docUsers.get(docId)
      if (users) {
        users.delete(userId)
        if (users.size === 0) docUsers.delete(docId)
      }
      broadcastUsers(docId)
    })
  })

  return { server, storage, docs, wss }
}

// Create test client with presence awareness
function createTestClient(docId, port = TEST_PORT) {
  return new Promise((resolve) => {
    const clientId = Math.random().toString(36).substring(7)
    const ws = new WebSocket(`ws://localhost:${port}?doc=${docId}`)
    let serverText = ""
    let myUserId = null
    let myColor = null
    let currentUsers = []
    const receivedMessages = []
    const cursorUpdates = []

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw)
      receivedMessages.push(msg)

      if (msg.type === "init") {
        serverText = msg.text
        myUserId = msg.userId
        myColor = msg.color
        currentUsers = msg.users || []
      }
      if (msg.type === "users") {
        currentUsers = msg.users
      }
      if (msg.type === "cursor") {
        cursorUpdates.push(msg)
      }
      if (msg.type === "op") {
        const textArr = serverText.split("")
        if (msg.op.type === "insert") textArr.splice(msg.op.offset, 0, msg.op.value)
        else if (msg.op.type === "delete") textArr.splice(msg.op.offset, 1)
        serverText = textArr.join("")
      }
    })

    ws.on("open", () => {
      resolve({
        ws,
        clientId,
        getText: () => serverText,
        getUserId: () => myUserId,
        getColor: () => myColor,
        getUsers: () => currentUsers,
        getCursorUpdates: () => cursorUpdates,
        getMessages: () => receivedMessages,
        insert: (value, offset) => {
          ws.send(JSON.stringify({ type: "insert", value, offset, clientId }))
        },
        delete: (offset) => {
          ws.send(JSON.stringify({ type: "delete", offset, clientId }))
        },
        sendCursor: (offset, selEnd) => {
          ws.send(JSON.stringify({ type: "cursor", offset, selEnd: selEnd != null ? selEnd : offset, clientId }))
        },
        close: () => ws.close()
      })
    })
  })
}

console.log("=".repeat(60))
console.log("E2E TESTS: Presence, Colors & Cursor Tracking")
console.log("=".repeat(60))

async function runTests() {

  // =========================================================
  // TEST 1: Init message includes userId, color, users
  // =========================================================
  console.log("\n[Test 1] Init message includes userId, color, and users list")
  cleanupTestDb()
  const { server: s1 } = createTestServer()
  await new Promise(r => s1.listen(TEST_PORT, r))
  const c1 = await createTestClient("t1")
  await sleep(200)
  assert(c1.getUserId() !== null, "userId is assigned")
  assert(c1.getUserId().startsWith("user"), "userId has 'user' prefix")
  assert(c1.getColor() !== null, "color is assigned")
  assert(c1.getColor().startsWith("#"), "color is a hex color")
  assertIncludes(USER_COLORS, c1.getColor(), "color is from the predefined pool")
  assert(c1.getUsers().length >= 1, "users list is non-empty")
  c1.close()
  await sleep(100)
  s1.close()
  await sleep(200)

  // =========================================================
  // TEST 2: Each user gets a unique userId
  // =========================================================
  console.log("\n[Test 2] Each user gets a unique userId")
  cleanupTestDb()
  const { server: s2 } = createTestServer()
  await new Promise(r => s2.listen(TEST_PORT, r))
  const c2a = await createTestClient("t2")
  const c2b = await createTestClient("t2")
  const c2c = await createTestClient("t2")
  await sleep(200)
  const ids2 = [c2a.getUserId(), c2b.getUserId(), c2c.getUserId()]
  assertEquals(new Set(ids2).size, 3, "all 3 userIds are distinct")
  c2a.close(); c2b.close(); c2c.close()
  await sleep(100)
  s2.close()
  await sleep(200)

  // =========================================================
  // TEST 3: Each user gets a unique color per document
  // =========================================================
  console.log("\n[Test 3] Each user gets a unique color within the same document")
  cleanupTestDb()
  const { server: s3 } = createTestServer()
  await new Promise(r => s3.listen(TEST_PORT, r))
  const c3a = await createTestClient("t3")
  const c3b = await createTestClient("t3")
  const c3c = await createTestClient("t3")
  await sleep(200)
  const colors3 = [c3a.getColor(), c3b.getColor(), c3c.getColor()]
  assertEquals(new Set(colors3).size, 3, "all 3 colors are distinct")
  c3a.close(); c3b.close(); c3c.close()
  await sleep(100)
  s3.close()
  await sleep(200)

  // =========================================================
  // TEST 4: Users list broadcasts on join
  // =========================================================
  console.log("\n[Test 4] Users list broadcasts when a new user joins")
  cleanupTestDb()
  const { server: s4 } = createTestServer()
  await new Promise(r => s4.listen(TEST_PORT, r))
  const c4a = await createTestClient("t4")
  await sleep(200)
  assertEquals(c4a.getUsers().length, 1, "initially 1 user")
  const c4b = await createTestClient("t4")
  await sleep(300)
  assertEquals(c4a.getUsers().length, 2, "client A sees 2 users after B joins")
  assertEquals(c4b.getUsers().length, 2, "client B sees 2 users")
  // Verify user objects have expected shape
  const u4 = c4a.getUsers()[0]
  assert(u4.id !== undefined, "user object has id")
  assert(u4.color !== undefined, "user object has color")
  assert(u4.cursor !== undefined, "user object has cursor")
  c4a.close(); c4b.close()
  await sleep(100)
  s4.close()
  await sleep(200)

  // =========================================================
  // TEST 5: Users list broadcasts on leave
  // =========================================================
  console.log("\n[Test 5] Users list broadcasts when a user leaves")
  cleanupTestDb()
  const { server: s5 } = createTestServer()
  await new Promise(r => s5.listen(TEST_PORT, r))
  const c5a = await createTestClient("t5")
  const c5b = await createTestClient("t5")
  await sleep(300)
  assertEquals(c5a.getUsers().length, 2, "2 users before disconnect")
  c5b.close()
  await sleep(300)
  assertEquals(c5a.getUsers().length, 1, "1 user after B disconnects")
  assertEquals(c5a.getUsers()[0].id, c5a.getUserId(), "remaining user is A")
  c5a.close()
  await sleep(100)
  s5.close()
  await sleep(200)

  // =========================================================
  // TEST 6: Cursor position broadcast to other clients
  // =========================================================
  console.log("\n[Test 6] Cursor position is broadcast to other clients")
  cleanupTestDb()
  const { server: s6 } = createTestServer()
  await new Promise(r => s6.listen(TEST_PORT, r))
  const c6a = await createTestClient("t6")
  const c6b = await createTestClient("t6")
  await sleep(200)
  c6a.sendCursor(5, 5)
  await sleep(200)
  assert(c6b.getCursorUpdates().length >= 1, "client B receives cursor update from A")
  const cu6 = c6b.getCursorUpdates()[c6b.getCursorUpdates().length - 1]
  assertEquals(cu6.userId, c6a.getUserId(), "cursor update has correct userId")
  assertEquals(cu6.offset, 5, "cursor offset is 5")
  assertEquals(cu6.selEnd, 5, "cursor selEnd is 5 (no selection)")
  assert(cu6.color !== undefined, "cursor update includes color")
  c6a.close(); c6b.close()
  await sleep(100)
  s6.close()
  await sleep(200)

  // =========================================================
  // TEST 7: Cursor update NOT echoed back to sender
  // =========================================================
  console.log("\n[Test 7] Cursor update is NOT echoed back to sender")
  cleanupTestDb()
  const { server: s7 } = createTestServer()
  await new Promise(r => s7.listen(TEST_PORT, r))
  const c7 = await createTestClient("t7")
  await sleep(200)
  c7.sendCursor(10, 10)
  await sleep(300)
  assertEquals(c7.getCursorUpdates().length, 0, "sender receives no cursor echo")
  c7.close()
  await sleep(100)
  s7.close()
  await sleep(200)

  // =========================================================
  // TEST 8: Selection range broadcast (offset !== selEnd)
  // =========================================================
  console.log("\n[Test 8] Selection range is broadcast correctly")
  cleanupTestDb()
  const { server: s8 } = createTestServer()
  await new Promise(r => s8.listen(TEST_PORT, r))
  const c8a = await createTestClient("t8")
  const c8b = await createTestClient("t8")
  await sleep(200)
  c8a.sendCursor(3, 10) // selection from 3 to 10
  await sleep(200)
  const cu8 = c8b.getCursorUpdates()[c8b.getCursorUpdates().length - 1]
  assertEquals(cu8.offset, 3, "selection start is 3")
  assertEquals(cu8.selEnd, 10, "selection end is 10")
  c8a.close(); c8b.close()
  await sleep(100)
  s8.close()
  await sleep(200)

  // =========================================================
  // TEST 9: Multiple cursor updates track latest position
  // =========================================================
  console.log("\n[Test 9] Multiple cursor updates - server tracks latest position")
  cleanupTestDb()
  const { server: s9 } = createTestServer()
  await new Promise(r => s9.listen(TEST_PORT, r))
  const c9a = await createTestClient("t9")
  const c9b = await createTestClient("t9")
  await sleep(200)
  c9a.sendCursor(1, 1)
  await sleep(50)
  c9a.sendCursor(5, 5)
  await sleep(50)
  c9a.sendCursor(20, 20)
  await sleep(200)
  const updates9 = c9b.getCursorUpdates()
  assert(updates9.length >= 1, "B received cursor updates")
  const last9 = updates9[updates9.length - 1]
  assertEquals(last9.offset, 20, "latest cursor position is 20")
  c9a.close(); c9b.close()
  await sleep(100)
  s9.close()
  await sleep(200)

  // =========================================================
  // TEST 10: Users on different docs are isolated
  // =========================================================
  console.log("\n[Test 10] Users on different documents are isolated")
  cleanupTestDb()
  const { server: s10 } = createTestServer()
  await new Promise(r => s10.listen(TEST_PORT, r))
  const c10a = await createTestClient("docA")
  const c10b = await createTestClient("docB")
  await sleep(300)
  // Each doc should only see 1 user
  assertEquals(c10a.getUsers().length, 1, "docA sees only 1 user")
  assertEquals(c10b.getUsers().length, 1, "docB sees only 1 user")
  // Cursor from docA should not reach docB
  c10a.sendCursor(42, 42)
  await sleep(200)
  assertEquals(c10b.getCursorUpdates().length, 0, "docB gets no cursor updates from docA")
  c10a.close(); c10b.close()
  await sleep(100)
  s10.close()
  await sleep(200)

  // =========================================================
  // TEST 11: Init message includes cursor positions of existing users
  // =========================================================
  console.log("\n[Test 11] New client receives existing users' cursor positions")
  cleanupTestDb()
  const { server: s11 } = createTestServer()
  await new Promise(r => s11.listen(TEST_PORT, r))
  const c11a = await createTestClient("t11")
  await sleep(200)
  c11a.sendCursor(15, 25)
  await sleep(200)
  const c11b = await createTestClient("t11")
  await sleep(300)
  // B's init should include A's cursor in the users list
  const usersFor11b = c11b.getUsers()
  const userA = usersFor11b.find(u => u.id === c11a.getUserId())
  assert(userA !== undefined, "B's user list includes A")
  assertEquals(userA.cursor.offset, 15, "A's cursor offset is 15 in B's init")
  assertEquals(userA.cursor.selEnd, 25, "A's cursor selEnd is 25 in B's init")
  c11a.close(); c11b.close()
  await sleep(100)
  s11.close()
  await sleep(200)

  // =========================================================
  // TEST 12: Color uniqueness with many users
  // =========================================================
  console.log("\n[Test 12] Color uniqueness with 5 concurrent users")
  cleanupTestDb()
  const { server: s12 } = createTestServer()
  await new Promise(r => s12.listen(TEST_PORT, r))
  const clients12 = []
  for (let i = 0; i < 5; i++) {
    clients12.push(await createTestClient("t12"))
    await sleep(50)
  }
  await sleep(300)
  const colors12 = clients12.map(c => c.getColor())
  assertEquals(new Set(colors12).size, 5, "all 5 users have distinct colors")
  for (const c of colors12) {
    assertIncludes(USER_COLORS, c, `color ${c} is from the pool`)
  }
  for (const c of clients12) c.close()
  await sleep(100)
  s12.close()
  await sleep(200)

  // =========================================================
  // TEST 13: Freed color is reused for next user
  // =========================================================
  console.log("\n[Test 13] When a user disconnects, their color slot is freed")
  cleanupTestDb()
  const { server: s13 } = createTestServer()
  await new Promise(r => s13.listen(TEST_PORT, r))
  const c13a = await createTestClient("t13")
  await sleep(200)
  const firstColor = c13a.getColor()
  c13a.close()
  await sleep(300)
  const c13b = await createTestClient("t13")
  await sleep(200)
  // The first color in the pool should be available again
  // (since no one else is on the doc, the new user gets the first pool color)
  assertEquals(c13b.getColor(), USER_COLORS[0], "first pool color is reused after disconnect")
  c13b.close()
  await sleep(100)
  s13.close()
  await sleep(200)

  // =========================================================
  // TEST 14: Cursor with insert operations
  // =========================================================
  console.log("\n[Test 14] Cursor updates work alongside insert operations")
  cleanupTestDb()
  const { server: s14 } = createTestServer()
  await new Promise(r => s14.listen(TEST_PORT, r))
  const c14a = await createTestClient("t14")
  const c14b = await createTestClient("t14")
  await sleep(200)
  c14a.insert("H", 0)
  c14a.insert("I", 1)
  await sleep(200)
  c14a.sendCursor(2, 2)
  await sleep(200)
  assertEquals(c14b.getText(), "HI", "B received the inserts")
  const cu14 = c14b.getCursorUpdates()
  assert(cu14.length >= 1, "B received cursor update after inserts")
  assertEquals(cu14[cu14.length - 1].offset, 2, "A's cursor is at position 2")
  c14a.close(); c14b.close()
  await sleep(100)
  s14.close()
  await sleep(200)

  // =========================================================
  // TEST 15: Three clients - full presence flow
  // =========================================================
  console.log("\n[Test 15] Three clients - complete presence lifecycle")
  cleanupTestDb()
  const { server: s15 } = createTestServer()
  await new Promise(r => s15.listen(TEST_PORT, r))
  const c15a = await createTestClient("t15")
  await sleep(200)
  assertEquals(c15a.getUsers().length, 1, "A alone: 1 user")
  const c15b = await createTestClient("t15")
  await sleep(300)
  assertEquals(c15a.getUsers().length, 2, "B joins: A sees 2")
  const c15c = await createTestClient("t15")
  await sleep(300)
  assertEquals(c15a.getUsers().length, 3, "C joins: A sees 3")
  assertEquals(c15b.getUsers().length, 3, "C joins: B sees 3")
  // B disconnects
  c15b.close()
  await sleep(300)
  assertEquals(c15a.getUsers().length, 2, "B leaves: A sees 2")
  assertEquals(c15c.getUsers().length, 2, "B leaves: C sees 2")
  // Verify remaining IDs
  const remaining15 = c15a.getUsers().map(u => u.id).sort()
  const expected15 = [c15a.getUserId(), c15c.getUserId()].sort()
  assertEquals(JSON.stringify(remaining15), JSON.stringify(expected15), "remaining users are A and C")
  c15a.close(); c15c.close()
  await sleep(100)
  s15.close()
  await sleep(200)

  // =========================================================
  // TEST 16: Connection stability - no spurious disconnects
  // =========================================================
  console.log("\n[Test 16] Connection stability - userId persists during idle period")
  cleanupTestDb()
  const { server: s16 } = createTestServer()
  await new Promise(r => s16.listen(TEST_PORT, r))
  const c16 = await createTestClient("t16")
  await sleep(200)
  const originalUserId = c16.getUserId()
  assert(originalUserId !== null, "userId assigned on connect")
  // Wait long enough to trigger any spurious timeouts (was 20s, now should be fine)
  // We test 3 seconds of idle to verify no premature disconnect
  await sleep(3000)
  // Check the WS is still open
  assertEquals(c16.ws.readyState, WebSocket.OPEN, "WebSocket still open after 3s idle")
  // The userId should still be the same (no reconnection happened)
  assertEquals(c16.getUserId(), originalUserId, "userId unchanged after idle period")
  c16.close()
  await sleep(100)
  s16.close()
  await sleep(200)

  // =========================================================
  // Summary
  // =========================================================
  console.log("\n" + "=".repeat(60))
  console.log("Presence, Colors & Cursor Tests Summary")
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

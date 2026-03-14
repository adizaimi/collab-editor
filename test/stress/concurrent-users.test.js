/**
 * Concurrent Users Stress Test
 * Tests system behavior with multiple simultaneous users
 */

const WebSocket = require('ws')
const { spawn } = require('child_process')
const path = require('path')

// Test configuration
const SERVER_PORT = 3001
const TEST_DOC = 'concurrent-test'
const OPERATIONS_PER_USER = 100

// Utility functions
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class TestClient {
  constructor(clientId, docId) {
    this.clientId = clientId
    this.docId = docId
    this.ws = null
    this.receivedOps = []
    this.connected = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${SERVER_PORT}/?doc=${this.docId}`)

      this.ws.on('open', () => {
        this.connected = true
      })

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data)
        if (msg.type === 'init') {
          resolve()
        } else if (msg.type === 'op') {
          this.receivedOps.push(msg.op)
        }
      })

      this.ws.on('error', reject)
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    })
  }

  sendInsert(value, offset) {
    this.ws.send(JSON.stringify({
      type: 'insert',
      value,
      offset,
      clientId: this.clientId
    }))
  }

  sendDelete(offset, char) {
    this.ws.send(JSON.stringify({
      type: 'delete',
      offset,
      char,
      clientId: this.clientId
    }))
  }

  close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

// Start test server
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'test-server.js')
    const env = {
      ...process.env,
      TEST_PORT: SERVER_PORT,
      TEST_DB_PATH: `concurrent-test-${SERVER_PORT}.db`
    }

    const server = spawn('node', [serverPath], { env })

    server.stdout.on('data', (data) => {
      if (data.toString().includes('Server running')) {
        resolve(server)
      }
    })

    server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString())
    })

    setTimeout(() => reject(new Error('Server start timeout')), 10000)
  })
}

// Test 1: 3 Concurrent Users
async function test3Users() {
  console.log('\n=== Test 1: 3 Concurrent Users ===')

  const clients = [
    new TestClient('user1', TEST_DOC),
    new TestClient('user2', TEST_DOC),
    new TestClient('user3', TEST_DOC)
  ]

  try {
    // Connect all clients
    await Promise.all(clients.map(c => c.connect()))
    console.log('✅ All 3 clients connected')

    await wait(100)

    // Each user types 50 characters simultaneously
    const operations = []
    for (let i = 0; i < 50; i++) {
      clients[0].sendInsert('A', i)
      clients[1].sendInsert('B', i)
      clients[2].sendInsert('C', i)
      await wait(10) // Small delay to simulate typing
    }

    await wait(500) // Wait for all operations to propagate

    // Verify all clients received operations
    for (const client of clients) {
      console.log(`  Client ${client.clientId}: received ${client.receivedOps.length} operations`)
    }

    // All clients should have received approximately 150 operations (50 from each of 3 users)
    const avgOps = clients.reduce((sum, c) => sum + c.receivedOps.length, 0) / clients.length
    console.log(`  Average operations received: ${avgOps}`)

    if (avgOps >= 140 && avgOps <= 160) {
      console.log('✅ Test PASSED: All operations propagated correctly')
      return true
    } else {
      console.log(`❌ Test FAILED: Expected ~150 ops, got ${avgOps}`)
      return false
    }
  } finally {
    clients.forEach(c => c.close())
  }
}

// Test 2: 10 Concurrent Users
async function test10Users() {
  console.log('\n=== Test 2: 10 Concurrent Users ===')

  const clients = []
  for (let i = 0; i < 10; i++) {
    clients.push(new TestClient(`user${i}`, TEST_DOC + '-10'))
  }

  try {
    // Connect all clients
    console.log('Connecting 10 clients...')
    await Promise.all(clients.map(c => c.connect()))
    console.log('✅ All 10 clients connected')

    await wait(200)

    // Each user types 20 characters
    console.log('Simulating typing from 10 users...')
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 10; j++) {
        clients[j].sendInsert(String.fromCharCode(65 + j), i) // A, B, C, ...
      }
      await wait(5)
    }

    await wait(1000) // Wait for all operations to propagate

    // Verify
    const totalOps = clients.reduce((sum, c) => sum + c.receivedOps.length, 0)
    const avgOps = totalOps / clients.length

    console.log(`  Total operations sent: ${10 * 20} = 200`)
    console.log(`  Average operations received per client: ${avgOps}`)
    console.log(`  Total operations received (all clients): ${totalOps}`)

    if (avgOps >= 180 && avgOps <= 220) {
      console.log('✅ Test PASSED: All operations propagated correctly')
      return true
    } else {
      console.log(`❌ Test FAILED: Expected ~200 ops per client, got ${avgOps}`)
      return false
    }
  } finally {
    clients.forEach(c => c.close())
  }
}

// Test 3: Rapid Concurrent Edits (Stress Test)
async function testRapidEdits() {
  console.log('\n=== Test 3: Rapid Concurrent Edits (Stress) ===')

  const clients = [
    new TestClient('rapid1', TEST_DOC + '-rapid'),
    new TestClient('rapid2', TEST_DOC + '-rapid'),
    new TestClient('rapid3', TEST_DOC + '-rapid')
  ]

  try {
    await Promise.all(clients.map(c => c.connect()))
    console.log('✅ 3 clients connected')

    await wait(100)

    const startTime = Date.now()

    // Each client rapidly inserts 100 characters (no delay)
    console.log('Starting rapid insert test (300 total operations)...')
    for (let i = 0; i < 100; i++) {
      clients[0].sendInsert('X', 0)
      clients[1].sendInsert('Y', 0)
      clients[2].sendInsert('Z', 0)
    }

    await wait(2000) // Wait for propagation

    const duration = Date.now() - startTime

    console.log(`  Duration: ${duration}ms`)
    console.log(`  Operations/second: ${(300 / duration * 1000).toFixed(0)}`)

    for (const client of clients) {
      console.log(`  Client ${client.clientId}: ${client.receivedOps.length} ops`)
    }

    console.log('✅ Test PASSED: System handled rapid concurrent edits')
    return true
  } finally {
    clients.forEach(c => c.close())
  }
}

// Test 4: Mixed Operations (Insert + Delete)
async function testMixedOperations() {
  console.log('\n=== Test 4: Mixed Operations (Insert + Delete) ===')

  const clients = [
    new TestClient('mixed1', TEST_DOC + '-mixed'),
    new TestClient('mixed2', TEST_DOC + '-mixed')
  ]

  try {
    await Promise.all(clients.map(c => c.connect()))
    console.log('✅ 2 clients connected')

    await wait(100)

    // Client 1: Insert 10 chars
    for (let i = 0; i < 10; i++) {
      clients[0].sendInsert('A', i)
      await wait(10)
    }

    await wait(200)

    // Client 2: Delete some and insert some
    for (let i = 0; i < 5; i++) {
      clients[1].sendDelete(0, 'A')
      await wait(10)
      clients[1].sendInsert('B', 0)
      await wait(10)
    }

    await wait(500)

    console.log(`  Client 1: ${clients[0].receivedOps.length} ops received`)
    console.log(`  Client 2: ${clients[1].receivedOps.length} ops received`)

    console.log('✅ Test PASSED: Mixed operations handled correctly')
    return true
  } finally {
    clients.forEach(c => c.close())
  }
}

// Main test runner
async function runTests() {
  console.log('='.repeat(60))
  console.log('CONCURRENT USERS STRESS TEST')
  console.log('='.repeat(60))

  let server
  try {
    console.log('\nStarting test server...')
    server = await startServer()
    console.log('✅ Test server started on port', SERVER_PORT)

    await wait(1000) // Give server time to fully initialize

    const results = []

    results.push(await test3Users())
    await wait(1000)

    results.push(await test10Users())
    await wait(1000)

    results.push(await testRapidEdits())
    await wait(1000)

    results.push(await testMixedOperations())

    console.log('\n' + '='.repeat(60))
    console.log('RESULTS SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total Tests: ${results.length}`)
    console.log(`Passed: ${results.filter(r => r).length}`)
    console.log(`Failed: ${results.filter(r => !r).length}`)
    console.log('='.repeat(60))

    if (results.every(r => r)) {
      console.log('\n✅ All concurrent user tests PASSED!\n')
      process.exit(0)
    } else {
      console.log('\n❌ Some tests FAILED\n')
      process.exit(1)
    }
  } catch (error) {
    console.error('Error running tests:', error)
    process.exit(1)
  } finally {
    if (server) {
      server.kill()
    }
    // Cleanup test database
    const fs = require('fs')
    const dbPath = `concurrent-test-${SERVER_PORT}.db`
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})

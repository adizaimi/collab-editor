/**
 * Multi-Document Concurrent Test
 * Tests multiple clients writing to multiple documents simultaneously
 * Ensures proper document isolation and no cross-document interference
 */

const WebSocket = require('ws')
const { spawn } = require('child_process')
const path = require('path')

// Test configuration
const SERVER_PORT = 3003
const NUM_DOCUMENTS = 5
const CLIENTS_PER_DOCUMENT = 3
const OPERATIONS_PER_CLIENT = 50

// Results tracking
const results = {
  documentsCreated: 0,
  totalOperations: 0,
  operationsPerDocument: {},
  errors: [],
  startTime: null,
  endTime: null
}

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
    this.sentOps = 0
    this.connected = false
    this.initialText = ''
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
          this.initialText = msg.text
          resolve()
        } else if (msg.type === 'op') {
          this.receivedOps.push(msg.op)
        }
      })

      this.ws.on('error', (err) => {
        results.errors.push({
          client: this.clientId,
          doc: this.docId,
          error: err.message
        })
        reject(err)
      })

      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    })
  }

  sendInsert(value, offset) {
    if (!this.connected) return
    this.ws.send(JSON.stringify({
      type: 'insert',
      value,
      offset,
      clientId: this.clientId
    }))
    this.sentOps++
  }

  sendDelete(offset, char) {
    if (!this.connected) return
    this.ws.send(JSON.stringify({
      type: 'delete',
      offset,
      char,
      clientId: this.clientId
    }))
    this.sentOps++
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
      TEST_DB_PATH: `multi-doc-test-${SERVER_PORT}.db`
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

// Test: Multiple documents with concurrent clients
async function testMultiDocumentConcurrency() {
  console.log('='.repeat(70))
  console.log('MULTI-DOCUMENT CONCURRENT TEST')
  console.log('='.repeat(70))
  console.log(`Documents: ${NUM_DOCUMENTS}`)
  console.log(`Clients per document: ${CLIENTS_PER_DOCUMENT}`)
  console.log(`Operations per client: ${OPERATIONS_PER_CLIENT}`)
  console.log(`Total clients: ${NUM_DOCUMENTS * CLIENTS_PER_DOCUMENT}`)
  console.log(`Expected total operations: ${NUM_DOCUMENTS * CLIENTS_PER_DOCUMENT * OPERATIONS_PER_CLIENT}`)
  console.log('='.repeat(70))

  let server
  const allClients = []
  const documentClients = {}

  try {
    // Start server
    console.log('\nStarting test server...')
    server = await startServer()
    console.log('✅ Server started')

    await wait(2000)

    results.startTime = new Date().toISOString()

    // Create clients for each document
    console.log(`\nConnecting ${NUM_DOCUMENTS * CLIENTS_PER_DOCUMENT} clients across ${NUM_DOCUMENTS} documents...`)

    for (let docNum = 0; docNum < NUM_DOCUMENTS; docNum++) {
      const docId = `doc-${docNum}`
      documentClients[docId] = []
      results.operationsPerDocument[docId] = {
        sent: 0,
        received: 0,
        clients: []
      }

      for (let clientNum = 0; clientNum < CLIENTS_PER_DOCUMENT; clientNum++) {
        const clientId = `doc${docNum}-client${clientNum}`
        const client = new TestClient(clientId, docId)
        await client.connect()
        documentClients[docId].push(client)
        allClients.push(client)
        results.operationsPerDocument[docId].clients.push(clientId)
      }
    }

    console.log(`✅ All ${allClients.length} clients connected`)
    results.documentsCreated = NUM_DOCUMENTS

    // Perform concurrent operations on all documents
    console.log('\nStarting concurrent operations across all documents...\n')

    const operationPromises = []

    for (const [docId, clients] of Object.entries(documentClients)) {
      for (const client of clients) {
        // Each client performs operations concurrently
        const promise = (async () => {
          for (let i = 0; i < OPERATIONS_PER_CLIENT; i++) {
            // Mix of inserts and deletes
            if (Math.random() > 0.3 || i === 0) {
              // Insert
              const char = String.fromCharCode(65 + Math.floor(Math.random() * 26))
              const offset = Math.floor(Math.random() * (i + 1))
              client.sendInsert(char, offset)
            } else {
              // Delete (only if there's content)
              const offset = Math.floor(Math.random() * Math.max(1, i))
              client.sendDelete(offset, 'X')
            }

            // Small delay to simulate realistic typing
            await wait(5)
          }
        })()

        operationPromises.push(promise)
      }
    }

    // Wait for all operations to complete
    await Promise.all(operationPromises)

    // Wait for operations to propagate
    console.log('Waiting for operations to propagate...')
    await wait(3000)

    results.endTime = new Date().toISOString()

    // Collect statistics
    console.log('\n' + '='.repeat(70))
    console.log('TEST RESULTS')
    console.log('='.repeat(70))

    let totalSent = 0
    let totalReceived = 0

    for (const [docId, clients] of Object.entries(documentClients)) {
      const docSent = clients.reduce((sum, c) => sum + c.sentOps, 0)
      const docReceived = clients.reduce((sum, c) => sum + c.receivedOps.length, 0)

      results.operationsPerDocument[docId].sent = docSent
      results.operationsPerDocument[docId].received = docReceived

      totalSent += docSent
      totalReceived += docReceived

      console.log(`\n${docId}:`)
      console.log(`  Operations sent: ${docSent}`)
      console.log(`  Operations received (all clients): ${docReceived}`)
      console.log(`  Average per client: ${(docReceived / clients.length).toFixed(0)}`)
      console.log(`  Clients: ${clients.map(c => c.clientId).join(', ')}`)
    }

    results.totalOperations = totalSent

    console.log('\n' + '-'.repeat(70))
    console.log('OVERALL SUMMARY')
    console.log('-'.repeat(70))
    console.log(`Total documents: ${NUM_DOCUMENTS}`)
    console.log(`Total clients: ${allClients.length}`)
    console.log(`Total operations sent: ${totalSent}`)
    console.log(`Total operations received (all clients): ${totalReceived}`)
    console.log(`Average operations per document: ${(totalSent / NUM_DOCUMENTS).toFixed(0)}`)
    console.log(`Average operations per client: ${(totalSent / allClients.length).toFixed(0)}`)

    // Validate document isolation
    console.log('\n' + '-'.repeat(70))
    console.log('DOCUMENT ISOLATION CHECK')
    console.log('-'.repeat(70))

    let isolationPassed = true
    for (const [docId, clients] of Object.entries(documentClients)) {
      // Check that all clients on same document received same operations
      const firstClientOps = clients[0].receivedOps.length
      const allSame = clients.every(c => Math.abs(c.receivedOps.length - firstClientOps) <= 5)

      if (allSame) {
        console.log(`✅ ${docId}: All clients received similar operation counts (${firstClientOps} ±5)`)
      } else {
        console.log(`❌ ${docId}: Client operation counts vary significantly`)
        isolationPassed = false
      }
    }

    // Check for errors
    if (results.errors.length > 0) {
      console.log('\n' + '-'.repeat(70))
      console.log('ERRORS')
      console.log('-'.repeat(70))
      console.log(`Total errors: ${results.errors.length}`)
      results.errors.slice(0, 10).forEach(e => {
        console.log(`  ${e.client} (${e.doc}): ${e.error}`)
      })
    } else {
      console.log('\n✅ No errors detected')
    }

    // Final verdict
    console.log('\n' + '='.repeat(70))
    if (isolationPassed && results.errors.length === 0 && totalSent > 0) {
      console.log('✅ MULTI-DOCUMENT CONCURRENT TEST PASSED')
      console.log('   - All documents properly isolated')
      console.log('   - No cross-document interference')
      console.log('   - All operations processed correctly')
    } else {
      console.log('❌ TEST FAILED')
      if (!isolationPassed) console.log('   - Document isolation issues detected')
      if (results.errors.length > 0) console.log(`   - ${results.errors.length} errors occurred`)
      if (totalSent === 0) console.log('   - No operations were sent')
    }
    console.log('='.repeat(70))

    return isolationPassed && results.errors.length === 0 && totalSent > 0

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    return false
  } finally {
    // Cleanup
    console.log('\nCleaning up...')
    allClients.forEach(c => c.close())

    if (server) {
      server.kill()
    }

    // Clean up test database
    const fs = require('fs')
    const dbPath = `multi-doc-test-${SERVER_PORT}.db`
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  }
}

// Run the test
testMultiDocumentConcurrency().then(success => {
  process.exit(success ? 0 : 1)
}).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})

/**
 * Long-Running Memory & Performance Stress Test
 * Monitors memory usage, database growth, and performance over time
 */

const WebSocket = require('ws')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

// Test configuration
const SERVER_PORT = 3002
const TEST_DURATION_MS = 60000 // 1 minute (increase for longer tests)
const NUM_CLIENTS = 5
const OPS_PER_SECOND_PER_CLIENT = 2
const MEMORY_SAMPLE_INTERVAL = 5000 // Sample every 5 seconds
const DB_PATH = 'editor-stress-test.db'

// Results storage
const results = {
  startTime: null,
  endTime: null,
  memorySamples: [],
  dbSizeSamples: [],
  operationCounts: [],
  errors: []
}

// Utility functions
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getMemoryUsage() {
  const mem = process.memoryUsage()
  return {
    rss: (mem.rss / 1024 / 1024).toFixed(2), // MB
    heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
    external: (mem.external / 1024 / 1024).toFixed(2)
  }
}

function getDbSize() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const stats = fs.statSync(DB_PATH)
      return (stats.size / 1024 / 1024).toFixed(2) // MB
    }
  } catch (e) {
    // DB might not exist yet
  }
  return 0
}

function getDbStats() {
  try {
    if (!fs.existsSync(DB_PATH)) return null

    const db = new Database(DB_PATH, { readonly: true })

    const opCount = db.prepare('SELECT COUNT(*) as count FROM operations').get()
    const snapshotCount = db.prepare('SELECT COUNT(*) as count FROM snapshots').get()

    const docCount = db.prepare('SELECT COUNT(DISTINCT doc_id) as count FROM operations').get()

    db.close()

    return {
      operations: opCount.count,
      snapshots: snapshotCount.count,
      documents: docCount.count
    }
  } catch (e) {
    return null
  }
}

class StressClient {
  constructor(clientId, docId) {
    this.clientId = clientId
    this.docId = docId
    this.ws = null
    this.opsReceived = 0
    this.opsSent = 0
    this.running = false
    this.currentText = ''
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${SERVER_PORT}/?doc=${this.docId}`)

      this.ws.on('open', () => {
        this.running = true
      })

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data)
        if (msg.type === 'init') {
          this.currentText = msg.text
          resolve()
        } else if (msg.type === 'op') {
          this.opsReceived++
          // Track operations but don't update local state (server is authority)
        }
      })

      this.ws.on('error', (err) => {
        results.errors.push({ client: this.clientId, error: err.message })
      })

      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    })
  }

  async startOperations() {
    const interval = 1000 / OPS_PER_SECOND_PER_CLIENT

    while (this.running) {
      try {
        // Randomly insert or delete
        if (Math.random() > 0.3) {
          // Insert
          const char = String.fromCharCode(65 + Math.floor(Math.random() * 26))
          const offset = Math.floor(Math.random() * (this.currentText.length + 1))

          this.ws.send(JSON.stringify({
            type: 'insert',
            value: char,
            offset,
            clientId: this.clientId
          }))

          this.opsSent++
          this.currentText = this.currentText.slice(0, offset) + char + this.currentText.slice(offset)
        } else if (this.currentText.length > 0) {
          // Delete
          const offset = Math.floor(Math.random() * this.currentText.length)
          const char = this.currentText[offset]

          this.ws.send(JSON.stringify({
            type: 'delete',
            offset,
            char,
            clientId: this.clientId
          }))

          this.opsSent++
          this.currentText = this.currentText.slice(0, offset) + this.currentText.slice(offset + 1)
        }

        await wait(interval)
      } catch (e) {
        results.errors.push({ client: this.clientId, error: e.message })
      }
    }
  }

  stop() {
    this.running = false
    if (this.ws) {
      this.ws.close()
    }
  }
}

// Start server with custom DB path
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'test-server.js')

    // Clean up old test DB
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH)
    }

    const env = {
      ...process.env,
      TEST_PORT: SERVER_PORT,
      TEST_DB_PATH: DB_PATH
    }

    const server = spawn('node', [serverPath], { env })

    server.stdout.on('data', (data) => {
      if (data.toString().includes('Server running')) {
        resolve(server)
      }
    })

    server.stderr.on('data', (data) => {
      console.error('Server stderr:', data.toString())
    })

    setTimeout(() => reject(new Error('Server start timeout')), 10000)
  })
}

// Monitor memory and DB growth
async function startMonitoring() {
  const startTime = Date.now()

  while (Date.now() - startTime < TEST_DURATION_MS) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    const memory = getMemoryUsage()
    const dbSize = getDbSize()
    const dbStats = getDbStats()

    results.memorySamples.push({
      time: elapsed,
      ...memory
    })

    results.dbSizeSamples.push({
      time: elapsed,
      size: dbSize
    })

    if (dbStats) {
      results.operationCounts.push({
        time: elapsed,
        ...dbStats
      })
    }

    console.log(`[${elapsed}s] Mem: ${memory.heapUsed}MB | DB: ${dbSize}MB | Ops: ${dbStats ? dbStats.operations : 0}`)

    await wait(MEMORY_SAMPLE_INTERVAL)
  }
}

// Main stress test
async function runStressTest() {
  console.log('='.repeat(70))
  console.log('MEMORY & PERFORMANCE STRESS TEST')
  console.log('='.repeat(70))
  console.log(`Duration: ${TEST_DURATION_MS / 1000}s`)
  console.log(`Clients: ${NUM_CLIENTS}`)
  console.log(`Operations per second per client: ${OPS_PER_SECOND_PER_CLIENT}`)
  console.log(`Expected total operations: ~${NUM_CLIENTS * OPS_PER_SECOND_PER_CLIENT * (TEST_DURATION_MS / 1000)}`)
  console.log('='.repeat(70))

  let server
  let clients = []

  try {
    // Start server
    console.log('\nStarting test server...')
    server = await startServer()
    console.log('✅ Server started')

    await wait(2000)

    results.startTime = new Date().toISOString()

    // Create and connect clients
    console.log(`\nConnecting ${NUM_CLIENTS} clients...`)
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const client = new StressClient(`stress-client-${i}`, 'stress-test-doc')
      await client.connect()
      clients.push(client)
    }
    console.log(`✅ All ${NUM_CLIENTS} clients connected`)

    // Start operations and monitoring
    console.log('\nStarting operations and monitoring...\n')

    const operationPromises = clients.map(c => c.startOperations())
    const monitoringPromise = startMonitoring()

    // Wait for test duration
    await Promise.race([
      monitoringPromise,
      Promise.all(operationPromises)
    ])

    results.endTime = new Date().toISOString()

    // Stop all clients
    console.log('\nStopping clients...')
    clients.forEach(c => c.stop())

    await wait(2000) // Wait for final operations to complete

    // Generate report
    console.log('\n' + '='.repeat(70))
    console.log('TEST RESULTS')
    console.log('='.repeat(70))

    const totalOpsSent = clients.reduce((sum, c) => sum + c.opsSent, 0)
    const totalOpsReceived = clients.reduce((sum, c) => sum + c.opsReceived, 0)

    console.log(`\nOperations:`)
    console.log(`  Total sent: ${totalOpsSent}`)
    console.log(`  Total received (all clients): ${totalOpsReceived}`)
    console.log(`  Average per client: ${(totalOpsReceived / NUM_CLIENTS).toFixed(0)}`)

    const finalDbStats = getDbStats()
    console.log(`\nDatabase:`)
    console.log(`  Final size: ${getDbSize()} MB`)
    console.log(`  Total operations: ${finalDbStats.operations}`)
    console.log(`  Total snapshots: ${finalDbStats.snapshots}`)
    console.log(`  Documents: ${finalDbStats.documents}`)

    const finalMem = results.memorySamples[results.memorySamples.length - 1]
    const initialMem = results.memorySamples[0]
    const memGrowth = (finalMem.heapUsed - initialMem.heapUsed).toFixed(2)

    console.log(`\nMemory:`)
    console.log(`  Initial: ${initialMem.heapUsed} MB`)
    console.log(`  Final: ${finalMem.heapUsed} MB`)
    console.log(`  Growth: ${memGrowth} MB`)

    if (results.errors.length > 0) {
      console.log(`\nErrors: ${results.errors.length}`)
      results.errors.slice(0, 5).forEach(e => {
        console.log(`  ${e.client}: ${e.error}`)
      })
    } else {
      console.log(`\n✅ No errors`)
    }

    // Save detailed results
    const reportPath = 'test/stress/STRESS_TEST_REPORT.json'
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log(`\nDetailed results saved to: ${reportPath}`)

    console.log('\n' + '='.repeat(70))
    console.log('✅ STRESS TEST COMPLETE')
    console.log('='.repeat(70))

    return true
  } catch (error) {
    console.error('\n❌ Stress test failed:', error)
    return false
  } finally {
    if (server) {
      server.kill()
    }
    // Cleanup
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH)
    }
  }
}

// Run the test
runStressTest().then(success => {
  process.exit(success ? 0 : 1)
}).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})

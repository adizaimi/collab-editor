const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const SQLiteStorage = require("./storage/sqlite")
const DocumentService = require("./services/document")
const SQLiteMetrics = require("./metrics/sqlite-metrics")

const storage = new SQLiteStorage()
storage.init()

// Initialize metrics
const metrics = new SQLiteMetrics({
  file: 'metrics.db',
  retentionDays: 7  // Keep 7 days of metrics
})

// Use async operation queue for better burst handling (5-10x throughput improvement)
const docs = new DocumentService(storage, {
  useAsyncQueue: true,
  queueOptions: {
    flushInterval: 500,      // Flush every 500ms
    maxBatchSize: 100,       // Max 100 ops per batch
    maxQueueSize: 1000       // Max 1000 ops queued per document
  }
})

// Snapshot configuration
const SNAPSHOT_THRESHOLD = 100 // Create snapshot every 100 operations
const SNAPSHOT_IDLE_TIME = 10000 // Create snapshot after 10s of inactivity

// Track last operation time per document for idle snapshots
const lastOperationTime = new Map()
const snapshotTimers = new Map()

const app = express()
app.use(express.static("public"))

// Metrics HTTP endpoint
app.get('/metrics', async (req, res) => {
  try {
    const { metric, last = '1h', group, breakdown } = req.query

    if (breakdown && metric) {
      // Get breakdown by labels
      const timeRange = parseTimeRange(last)
      const result = metrics.getBreakdown(metric, {
        startTime: timeRange.start,
        endTime: timeRange.end
      })
      res.json(result)
    } else if (metric) {
      // Get stats for specific metric
      const timeRange = parseTimeRange(last)
      const stats = await metrics.getStats(metric, {
        startTime: timeRange.start,
        endTime: timeRange.end,
        groupBy: group
      })
      res.json(stats)
    } else {
      // Get summary
      const summary = metrics.getSummary()
      res.json(summary)
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Helper function for time range parsing
function parseTimeRange(timeStr) {
  const now = Date.now()
  const matches = timeStr.match(/^(\d+)([smhd])$/)

  if (!matches) {
    return { start: now - (60 * 60 * 1000), end: now }
  }

  const amount = parseInt(matches[1])
  const unit = matches[2]

  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  }

  const duration = amount * multipliers[unit]

  return {
    start: now - duration,
    end: now
  }
}

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

// User presence tracking: docId -> Map<userId, ws>
const docUsers = new Map()
let userCounter = 0

function assignUserId() {
  userCounter++
  return `user${userCounter}`
}

function getUsersForDoc(docId) {
  const users = docUsers.get(docId)
  return users ? Array.from(users.keys()) : []
}

function broadcastUsers(docId) {
  const users = getUsersForDoc(docId)
  broadcast(docId, { type: "users", users })
}

function broadcast(docId, msg){
  for(const c of wss.clients){
    if(c.readyState===WebSocket.OPEN && c.docId===docId) c.send(JSON.stringify(msg))
  }
}

// Heartbeat: ping every client every 10s, terminate if no pong within 30s
const HEARTBEAT_INTERVAL = 10000
const HEARTBEAT_TIMEOUT = 30000

const heartbeatTimer = setInterval(() => {
  const now = Date.now()
  for (const client of wss.clients) {
    if (now - client.lastPong > HEARTBEAT_TIMEOUT) {
      console.log(`[Heartbeat] Terminating unresponsive client (doc: ${client.docId})`)
      client.terminate()
      continue
    }
    if (client.readyState === WebSocket.OPEN) {
      client.ping()
    }
  }
}, HEARTBEAT_INTERVAL)

wss.on('close', () => {
  clearInterval(heartbeatTimer)
})

wss.on("connection",(ws,req)=>{
  const url = new URL(req.url, "http://x")
  const docId = url.searchParams.get("doc") || "main"
  const userId = assignUserId()
  ws.docId = docId
  ws.userId = userId
  ws.lastPong = Date.now()

  ws.on('pong', () => {
    ws.lastPong = Date.now()
  })

  // Register user in document presence
  if (!docUsers.has(docId)) {
    docUsers.set(docId, new Map())
  }
  docUsers.get(docId).set(userId, ws)

  // Track connection metrics
  metrics.increment('connections.total')
  metrics.record('connections.active', wss.clients.size)
  metrics.increment('connections.by_document', { doc_id: docId })

  // Send full document text and assigned userId to new client
  const text = docs.getText(docId)
  ws.send(JSON.stringify({type:"init", text, userId, users: getUsersForDoc(docId)}))

  // Track document size metrics
  metrics.record('document.text_length', text.length, { doc_id: docId })

  ws.on("message", msg=>{
    const startTime = Date.now()

    let data
    try {
      data = JSON.parse(msg)
    } catch (error) {
      console.error('[WebSocket] Invalid JSON:', error.message)
      metrics.increment('errors.invalid_json', { doc_id: docId })
      ws.send(JSON.stringify({type: 'error', message: 'Invalid message format'}))
      return
    }

    // Validate message structure
    if (!data.type || !data.clientId) {
      console.error('[WebSocket] Missing required fields:', data)
      metrics.increment('errors.invalid_message', { doc_id: docId })
      ws.send(JSON.stringify({type: 'error', message: 'Missing required fields'}))
      return
    }

    const crdt = docs.getCRDT(docId)
    let op = null
    let broadcastOp = null

    if(data.type==="insert"){
      const afterId = crdt.getIdAtOffset(data.offset - 1)
      // Include clientId to prevent ID collisions across concurrent clients
      op = {type:"insert", id:`${data.clientId}:${Date.now()}:${Math.random()}`, value:data.value, after:afterId}

      // Apply with batching
      const actualOffset = docs.applyOperationWithBatching(docId, op, data.clientId)

      broadcastOp = {type:"insert", offset: actualOffset, value:data.value, clientId:data.clientId}
    } else if(data.type==="delete"){
      const chars = crdt.getVisibleChars()
      let charId = null

      // Try to find character at offset
      if(data.offset < chars.length){
        charId = chars[data.offset].id
      }

      if(!charId) {
        console.warn(`[Delete] Character not found at offset ${data.offset} for doc ${docId}`)
        return // Character not found - operation rejected
      }

      op = {type:"delete", id: charId}
      // Calculate offset before deletion
      const offsetBeforeDelete = crdt.getOffsetOfId(op.id)

      // Apply with batching
      docs.applyOperationWithBatching(docId, op, data.clientId, offsetBeforeDelete)

      broadcastOp = {type:"delete", offset: offsetBeforeDelete, clientId:data.clientId}
    }

    if(broadcastOp){
      broadcast(docId, {type:"op", op:broadcastOp})
    }

    // Track operation metrics
    const latency = Date.now() - startTime
    metrics.increment('operations.total', { type: data.type, doc_id: docId })
    metrics.timing('operations.latency', latency, { type: data.type })

    // Track operation time for idle snapshot
    lastOperationTime.set(docId, Date.now())

    // Reset snapshot idle timer
    if(snapshotTimers.has(docId)){
      clearTimeout(snapshotTimers.get(docId))
    }
    snapshotTimers.set(docId, setTimeout(() => {
      createIdleSnapshot(docId)
    }, SNAPSHOT_IDLE_TIME))

    // Check if snapshot needed based on operation count
    if(docs.shouldCreateSnapshot(docId, SNAPSHOT_THRESHOLD)){
      createSnapshot(docId)
    }
  })

  // Notify other clients that a new user joined (after init is sent)
  broadcastUsers(docId)

  // Track disconnections
  ws.on('close', () => {
    // Remove user from document presence
    const users = docUsers.get(docId)
    if (users) {
      users.delete(userId)
      if (users.size === 0) {
        docUsers.delete(docId)
      }
    }
    broadcastUsers(docId)

    metrics.record('connections.active', wss.clients.size)
    metrics.increment('connections.disconnected')
  })
})

// Helper function to create snapshot
async function createSnapshot(docId) {
  try {
    await docs.createSnapshot(docId)
    console.log(`[Snapshot] Created snapshot for document: ${docId}`)
  } catch (err) {
    console.error(`[Snapshot] Error creating snapshot for ${docId}:`, err)
  }
}

// Helper function to create snapshot on idle
async function createIdleSnapshot(docId) {
  // Flush buffer and create snapshot
  await docs.flushBuffer(docId)
  console.log(`[Snapshot] Flushed buffer for document: ${docId} (idle)`)

  // Optionally create snapshot on idle (commented out to avoid too many snapshots)
  // await createSnapshot(docId)
}

// Periodic metrics collection (every 10 seconds)
setInterval(() => {
  // Queue metrics
  const queueStats = docs.getQueueStats()
  if (queueStats) {
    metrics.record('queue.pending', queueStats.pending)
    metrics.record('queue.processed_total', queueStats.totalProcessed)
    metrics.record('queue.errors', queueStats.errors)
    metrics.record('queue.active_queues', queueStats.activeQueues)
  }

  // Connection metrics
  metrics.record('connections.active', wss.clients.size)

  // Document metrics
  for (const [docId, doc] of docs.docs.entries()) {
    metrics.record('document.crdt_size', doc.chars.size, { doc_id: docId })
    metrics.record('document.text_length', doc.getText().length, { doc_id: docId })
  }

  // Memory metrics
  const memUsage = process.memoryUsage()
  metrics.record('memory.heap_used', memUsage.heapUsed)
  metrics.record('memory.heap_total', memUsage.heapTotal)
  metrics.record('memory.rss', memUsage.rss)
  metrics.record('memory.external', memUsage.external)
}, 10000)

// Memory cleanup - remove inactive document timers every hour
setInterval(() => {
  const now = Date.now()
  const INACTIVE_THRESHOLD = 60 * 60 * 1000 // 1 hour

  let cleanedCount = 0
  for (const [docId, lastTime] of lastOperationTime.entries()) {
    if (now - lastTime > INACTIVE_THRESHOLD) {
      // Clear snapshot timer
      if (snapshotTimers.has(docId)) {
        clearTimeout(snapshotTimers.get(docId))
        snapshotTimers.delete(docId)
      }
      lastOperationTime.delete(docId)
      cleanedCount++
    }
  }

  if (cleanedCount > 0) {
    console.log(`[Cleanup] Removed timers for ${cleanedCount} inactive documents`)
    metrics.increment('cleanup.inactive_documents', {}, cleanedCount)
  }

  // Also cleanup buffer map
  if (docs.buffer) {
    const cleaned = docs.buffer.cleanupInactive()
    if (cleaned > 0) {
      metrics.increment('cleanup.inactive_queues', {}, cleaned)
    }
  }
}, 60 * 60 * 1000) // Run every hour

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  await docs.flushBuffers()
  await metrics.close()
  storage.close()
  console.log('[Shutdown] Shutdown complete. Exiting.')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  await docs.flushBuffers()
  await metrics.close()
  storage.close()
  console.log('[Shutdown] Shutdown complete. Exiting.')
  process.exit(0)
})

server.listen(3000,()=>console.log("Server running at http://localhost:3000/?doc=test"))
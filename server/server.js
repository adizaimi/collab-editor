const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const SQLiteStorage = require("./storage/sqlite")
const DocumentService = require("./services/document")

const storage = new SQLiteStorage()
storage.init()

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

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

function broadcast(docId, msg){
  for(const c of wss.clients){
    if(c.readyState===WebSocket.OPEN && c.docId===docId) c.send(JSON.stringify(msg))
  }
}

wss.on("connection",(ws,req)=>{
  const url = new URL(req.url, "http://x")
  const docId = url.searchParams.get("doc") || "main"
  ws.docId = docId

  // send full document text to new client
  ws.send(JSON.stringify({type:"init", text:docs.getText(docId)}))

  ws.on("message", msg=>{
    let data
    try {
      data = JSON.parse(msg)
    } catch (error) {
      console.error('[WebSocket] Invalid JSON:', error.message)
      ws.send(JSON.stringify({type: 'error', message: 'Invalid message format'}))
      return
    }

    // Validate message structure
    if (!data.type || !data.clientId) {
      console.error('[WebSocket] Missing required fields:', data)
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
  }

  // Also cleanup buffer map
  if (docs.buffer) {
    docs.buffer.cleanupInactive()
  }
}, 60 * 60 * 1000) // Run every hour

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  await docs.flushBuffers()
  storage.close()
  console.log('[Shutdown] Shutdown complete. Exiting.')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  await docs.flushBuffers()
  storage.close()
  console.log('[Shutdown] Shutdown complete. Exiting.')
  process.exit(0)
})

server.listen(3000,()=>console.log("Server running at http://localhost:3000/?doc=test"))
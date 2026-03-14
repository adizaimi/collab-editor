const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const SQLiteStorage = require("./storage/sqlite")
const DocumentService = require("./services/document")

const storage = new SQLiteStorage()
storage.init()
const docs = new DocumentService(storage, true) // Enable batching

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
    const data = JSON.parse(msg)
    const crdt = docs.getCRDT(docId)
    let op = null
    let broadcastOp = null

    if(data.type==="insert"){
      const afterId = crdt.getIdAtOffset(data.offset - 1)
      op = {type:"insert", id:`${Date.now()}:${Math.random()}`, value:data.value, after:afterId}

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
      // If offset is stale, try to find by character value
      else if(data.char){
        for(const c of chars){
          if(c.value === data.char){
            charId = c.id
            break
          }
        }
      }

      if(!charId) return // Character not found

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
function createSnapshot(docId) {
  try {
    docs.createSnapshot(docId)
    console.log(`[Snapshot] Created snapshot for document: ${docId}`)
  } catch (err) {
    console.error(`[Snapshot] Error creating snapshot for ${docId}:`, err)
  }
}

// Helper function to create snapshot on idle
function createIdleSnapshot(docId) {
  // Flush buffer and create snapshot
  docs.flushBuffer(docId)
  console.log(`[Snapshot] Flushed buffer for document: ${docId} (idle)`)

  // Optionally create snapshot on idle (commented out to avoid too many snapshots)
  // createSnapshot(docId)
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  docs.flushBuffers()
  console.log('[Shutdown] Buffers flushed. Exiting.')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] Flushing all buffers before exit...')
  docs.flushBuffers()
  console.log('[Shutdown] Buffers flushed. Exiting.')
  process.exit(0)
})

server.listen(3000,()=>console.log("Server running at http://localhost:3000/?doc=test"))
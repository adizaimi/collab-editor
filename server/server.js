const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const SQLiteStorage = require("./storage/sqlite")
const DocumentService = require("./services/document")

const storage = new SQLiteStorage()
storage.init()
const docs = new DocumentService(storage)

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
      docs.applyOperation(docId, op)
      // Calculate offset after insertion
      const offset = crdt.getOffsetOfId(op.id)
      broadcastOp = {type:"insert", offset, value:data.value, clientId:data.clientId}
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
      const offset = crdt.getOffsetOfId(op.id)
      docs.applyOperation(docId, op)
      broadcastOp = {type:"delete", offset, clientId:data.clientId}
    }

    if(broadcastOp){
      broadcast(docId, {type:"op", op:broadcastOp})
    }
  })
})

server.listen(3000,()=>console.log("Server running at http://localhost:3000/?doc=test"))
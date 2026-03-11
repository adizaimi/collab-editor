// server/server.js
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

  const text = docs.getText(docId)
  ws.send(JSON.stringify({type:"init", text}))

  ws.on("message", msg=>{
    const data = JSON.parse(msg)
    if(data.type==="insert" || data.type==="delete"){
      // server computes afterId
      const crdt = docs.getCRDT(docId)
      let op = data
      if(data.type==="insert"){
        // map offset to afterId
        const afterId = crdt.getIdAtOffset(data.offset)
        op = {type:"insert", id:`${Date.now()}:${Math.random()}`, value:data.value, after:afterId}
      } else if(data.type==="delete"){
        const crdtChars = crdt.getVisibleChars()
        if(data.offset >= crdtChars.length) return
        op = {type:"delete", id:crdtChars[data.offset].id}
      }

      docs.applyOperation(docId, op)
      broadcast(docId, {type:"op", op})
    }
  })
})

server.listen(3000,()=>console.log("http://localhost:3000/?doc=test"))
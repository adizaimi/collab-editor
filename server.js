const express = require("express")
const WebSocket = require("ws")
const http = require("http")
const SQLiteStorage = require("./storage/sqlite")

const storage = new SQLiteStorage()
const DOC_ID = "main"

let currentDoc = ""
let operationCount = 0

async function start() {

  await storage.init()
  currentDoc = await storage.getDocument(DOC_ID)

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocket.Server({ server })

  app.use(express.static("editor"))

  wss.on("connection", (ws) => {

    ws.send(JSON.stringify({
      type: "init",
      content: currentDoc
    }))

    ws.on("message", async (msg) => {
      const data = JSON.parse(msg)

      if (data.type === "edit") {

        currentDoc = data.content

        const op = {
          content: currentDoc
        }

        await storage.saveOperation(DOC_ID, op)

        operationCount++

        // snapshot every 20 ops
        if (operationCount % 20 === 0) {
          await storage.saveSnapshot(DOC_ID, currentDoc)
        }

        broadcast(data)
      }
    })
  })

  function broadcast(data) {
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(JSON.stringify(data))
      }
    })
  }

  server.listen(3000, () => {
    console.log("Editor running on http://localhost:3000")
  })
}

start()

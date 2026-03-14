const WebSocket = require("ws")

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test() {
  console.log("Testing insert in middle of document...\n")

  const ws = new WebSocket(`ws://localhost:3000?doc=middle-test`)
  const clientId = "test-client"
  let serverText = ""

  ws.on("open", async () => {
    console.log("Connected to server")

    // Wait for init
    await sleep(200)

    // Insert "HELLO"
    console.log('\n1. Inserting "HELLO" at position 0')
    for(let i = 0; i < "HELLO".length; i++){
      ws.send(JSON.stringify({
        type: "insert",
        value: "HELLO"[i],
        offset: i,
        clientId
      }))
    }

    await sleep(500)
    console.log(`   Server text should be: "HELLO"`)
    console.log(`   Actual: "${serverText}"`)

    // Insert "X" in the middle (position 2, between L and L)
    console.log('\n2. Inserting "X" at position 2 (middle)')
    ws.send(JSON.stringify({
      type: "insert",
      value: "X",
      offset: 2,
      clientId
    }))

    await sleep(500)
    console.log(`   Server text should be: "HEXLLO"`)
    console.log(`   Actual: "${serverText}"`)

    if(serverText === "HEXLLO"){
      console.log("\n✅ TEST PASSED - Insert in middle works correctly!")
    } else {
      console.log("\n❌ TEST FAILED - Insert in middle broken")
    }

    ws.close()
    process.exit(serverText === "HEXLLO" ? 0 : 1)
  })

  ws.on("message", (data) => {
    const msg = JSON.parse(data)
    if(msg.type === "init"){
      serverText = msg.text
    }
    if(msg.type === "op"){
      const textArr = serverText.split("")
      if(msg.op.type === "insert"){
        textArr.splice(msg.op.offset, 0, msg.op.value)
      } else if(msg.op.type === "delete"){
        textArr.splice(msg.op.offset, 1)
      }
      serverText = textArr.join("")
    }
  })
}

test()

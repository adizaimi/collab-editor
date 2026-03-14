const WebSocket = require("ws")

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test() {
  console.log("Testing text replacement (delete selection + insert)...\n")

  const ws = new WebSocket(`ws://localhost:3000?doc=replace-test`)
  const clientId = "test-client"
  let serverText = ""

  ws.on("open", async () => {
    console.log("Connected to server")
    await sleep(200)

    // Insert "HELLO WORLD"
    console.log('1. Inserting "HELLO WORLD"')
    const text = "HELLO WORLD"
    for(let i = 0; i < text.length; i++){
      ws.send(JSON.stringify({
        type: "insert",
        value: text[i],
        offset: i,
        clientId
      }))
    }

    await sleep(500)
    console.log(`   Text: "${serverText}"\n`)

    // Simulate selecting "WORLD" (positions 6-11) and typing "THERE"
    // This should delete "WORLD" and insert "THERE"
    console.log('2. Replacing "WORLD" (offset 6-11) with "THERE"')

    // Delete 5 characters starting at position 6
    for(let i = 0; i < 5; i++){
      ws.send(JSON.stringify({
        type: "delete",
        offset: 6, // Always delete at position 6
        char: serverText[6],
        clientId
      }))
    }

    await sleep(300)
    console.log(`   After delete: "${serverText}"`)

    // Insert "THERE"
    const replacement = "THERE"
    for(let i = 0; i < replacement.length; i++){
      ws.send(JSON.stringify({
        type: "insert",
        value: replacement[i],
        offset: 6 + i,
        clientId
      }))
    }

    await sleep(500)
    console.log(`   After insert: "${serverText}"`)
    console.log(`   Expected: "HELLO THERE"`)

    if(serverText === "HELLO THERE"){
      console.log("\n✅ TEST PASSED - Text replacement works correctly!")
    } else {
      console.log("\n❌ TEST FAILED - Text replacement broken")
    }

    ws.close()
    process.exit(serverText === "HELLO THERE" ? 0 : 1)
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

const WebSocket = require("ws")

// Helper to create a client connection
function createClient(docId = "test") {
  return new Promise((resolve) => {
    const clientId = Math.random().toString(36).substring(7)
    const ws = new WebSocket(`ws://localhost:3000?doc=${docId}`)
    let text = ""
    const receivedOps = []

    ws.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "init") {
        text = msg.text
      }
      if (msg.type === "op") {
        receivedOps.push(msg.op)
        // Apply ALL operations from server (keeps us in sync)
        const textArr = text.split("")
        if (msg.op.type === "insert") {
          textArr.splice(msg.op.offset, 0, msg.op.value)
        } else if (msg.op.type === "delete") {
          textArr.splice(msg.op.offset, 1)
        }
        text = textArr.join("")
      }
    })

    ws.on("open", () => {
      resolve({
        ws,
        clientId,
        getText: () => text,
        getReceivedOps: () => receivedOps,
        insert: (value, offset) => {
          // Send to server (server will broadcast back)
          ws.send(JSON.stringify({ type: "insert", value, offset, clientId }))
        },
        delete: (offset) => {
          // Send to server (server will broadcast back)
          const char = text[offset]
          ws.send(JSON.stringify({ type: "delete", offset, char, clientId }))
        },
        close: () => ws.close()
      })
    })
  })
}

// Helper to wait for a condition
function waitFor(fn, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - start > timeout) {
        clearInterval(interval)
        reject(new Error("Timeout waiting for condition"))
      }
    }, 50)
  })
}

// Helper to wait
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runTests() {
  console.log("Starting concurrent editing tests...\n")
  let passedTests = 0
  let totalTests = 0

  // Test 1: Concurrent insertions at different positions
  totalTests++
  console.log("Test 1: Concurrent insertions at different positions")
  try {
    const client1 = await createClient("test1")
    const client2 = await createClient("test1")

    await sleep(200) // Let clients initialize

    // Client 1 inserts "ABC" at position 0
    client1.insert("A", 0)
    client1.insert("B", 1)
    client1.insert("C", 2)

    // Client 2 inserts "XYZ" at position 0
    client2.insert("X", 0)
    client2.insert("Y", 1)
    client2.insert("Z", 2)

    // Wait for sync
    await sleep(500)

    const text1 = client1.getText()
    const text2 = client2.getText()
    const ops1 = client1.getReceivedOps()
    const ops2 = client2.getReceivedOps()

    console.log(`  Client 1 text: "${text1}"`)
    console.log(`  Client 1 received ${ops1.length} ops:`, ops1.map(o => `${o.type}:${o.value}@${o.offset}:${o.clientId.substring(0,3)}`).join(', '))
    console.log(`  Client 2 text: "${text2}"`)
    console.log(`  Client 2 received ${ops2.length} ops:`, ops2.map(o => `${o.type}:${o.value}@${o.offset}:${o.clientId.substring(0,3)}`).join(', '))

    if (text1 === text2 && text1.length === 6) {
      console.log("  ✅ PASSED - Both clients have same text with all 6 characters\n")
      passedTests++
    } else {
      console.log("  ❌ FAILED - Texts don't match or wrong length\n")
    }

    client1.close()
    client2.close()
    await sleep(200)
  } catch (error) {
    console.log(`  ❌ FAILED - Error: ${error.message}\n`)
  }

  // Test 2: Concurrent deletions
  totalTests++
  console.log("Test 2: Concurrent deletions from shared text")
  try {
    const client1 = await createClient("test2")
    const client2 = await createClient("test2")

    await sleep(200)

    // Client 1 creates initial text "HELLO"
    client1.insert("H", 0)
    client1.insert("E", 1)
    client1.insert("L", 2)
    client1.insert("L", 3)
    client1.insert("O", 4)

    await sleep(500) // Wait for client2 to receive

    // Both clients try to delete at different positions
    client1.delete(0) // Delete "H"
    client2.delete(4) // Delete "O"

    await sleep(500)

    const text1 = client1.getText()
    const text2 = client2.getText()

    console.log(`  Client 1 text: "${text1}"`)
    console.log(`  Client 2 text: "${text2}"`)

    if (text1 === text2 && text1.length === 3) {
      console.log("  ✅ PASSED - Both clients converged to same 3-character text\n")
      passedTests++
    } else {
      console.log("  ❌ FAILED - Texts don't match or wrong length\n")
    }

    client1.close()
    client2.close()
    await sleep(200)
  } catch (error) {
    console.log(`  ❌ FAILED - Error: ${error.message}\n`)
  }

  // Test 3: Mixed concurrent operations
  totalTests++
  console.log("Test 3: Mixed concurrent insert and delete operations")
  try {
    const client1 = await createClient("test3")
    const client2 = await createClient("test3")
    const client3 = await createClient("test3")

    await sleep(200)

    // Client 1 inserts "TEST"
    client1.insert("T", 0)
    client1.insert("E", 1)
    client1.insert("S", 2)
    client1.insert("T", 3)

    await sleep(300)

    // Concurrent operations
    client1.insert("!", 4)        // Insert at end
    client2.delete(0)             // Delete first char
    client3.insert("X", 2)        // Insert in middle

    await sleep(500)

    const text1 = client1.getText()
    const text2 = client2.getText()
    const text3 = client3.getText()

    console.log(`  Client 1 text: "${text1}"`)
    console.log(`  Client 2 text: "${text2}"`)
    console.log(`  Client 3 text: "${text3}"`)

    if (text1 === text2 && text2 === text3 && text1.length === 5) {
      console.log("  ✅ PASSED - All 3 clients converged to same state\n")
      passedTests++
    } else {
      console.log("  ❌ FAILED - Clients don't have same text\n")
    }

    client1.close()
    client2.close()
    client3.close()
    await sleep(200)
  } catch (error) {
    console.log(`  ❌ FAILED - Error: ${error.message}\n`)
  }

  // Test 4: Rapid typing simulation
  totalTests++
  console.log("Test 4: Rapid typing from two users")
  try {
    const client1 = await createClient("test4")
    const client2 = await createClient("test4")

    await sleep(200)

    // Client 1 types "Alice: " quickly
    const text1 = "Alice: "
    for (let i = 0; i < text1.length; i++) {
      client1.insert(text1[i], i)
      await sleep(10)
    }

    // Client 2 types "Bob: " quickly at same time
    const text2 = "Bob: "
    for (let i = 0; i < text2.length; i++) {
      client2.insert(text2[i], i)
      await sleep(10)
    }

    await sleep(1000)

    const final1 = client1.getText()
    const final2 = client2.getText()

    console.log(`  Client 1 text: "${final1}"`)
    console.log(`  Client 2 text: "${final2}"`)
    console.log(`  Expected length: ${text1.length + text2.length}`)
    console.log(`  Actual length: ${final1.length}`)

    if (final1 === final2 && final1.length === text1.length + text2.length) {
      console.log("  ✅ PASSED - Rapid typing converged correctly\n")
      passedTests++
    } else {
      console.log("  ❌ FAILED - Texts don't match or wrong length\n")
    }

    client1.close()
    client2.close()
    await sleep(200)
  } catch (error) {
    console.log(`  ❌ FAILED - Error: ${error.message}\n`)
  }

  // Test 5: Concurrent edits at same position
  totalTests++
  console.log("Test 5: Concurrent inserts at same position")
  try {
    const client1 = await createClient("test5")
    const client2 = await createClient("test5")
    const client3 = await createClient("test5")

    await sleep(200)

    // All clients insert at position 0 simultaneously
    client1.insert("1", 0)
    client2.insert("2", 0)
    client3.insert("3", 0)

    await sleep(500)

    const text1 = client1.getText()
    const text2 = client2.getText()
    const text3 = client3.getText()

    console.log(`  Client 1 text: "${text1}"`)
    console.log(`  Client 2 text: "${text2}"`)
    console.log(`  Client 3 text: "${text3}"`)

    if (text1 === text2 && text2 === text3 && text1.length === 3) {
      console.log("  ✅ PASSED - All inserts preserved, clients converged\n")
      passedTests++
    } else {
      console.log("  ❌ FAILED - Clients don't match\n")
    }

    client1.close()
    client2.close()
    client3.close()
    await sleep(200)
  } catch (error) {
    console.log(`  ❌ FAILED - Error: ${error.message}\n`)
  }

  // Summary
  console.log("=".repeat(50))
  console.log(`Test Results: ${passedTests}/${totalTests} passed`)
  console.log("=".repeat(50))

  process.exit(passedTests === totalTests ? 0 : 1)
}

// Run tests
runTests().catch(err => {
  console.error("Test suite error:", err)
  process.exit(1)
})

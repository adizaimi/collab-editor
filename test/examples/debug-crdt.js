const CRDTText = require("../server/crdt/text")

const crdt = new CRDTText()

console.log("Building 'HELLO':\n")

// Insert H at 0
let id = "1:h"
let afterId = crdt.getIdAtOffset(-1)
console.log(`Insert 'H' at offset 0, afterId="${afterId}"`)
crdt.insert("H", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}\n`)

// Insert E at 1
id = "2:e"
afterId = crdt.getIdAtOffset(0)
console.log(`Insert 'E' at offset 1, afterId="${afterId}"`)
crdt.insert("E", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}\n`)

// Insert first L at 2
id = "3:l1"
afterId = crdt.getIdAtOffset(1)
console.log(`Insert 'L' at offset 2, afterId="${afterId}"`)
crdt.insert("L", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}\n`)

// Insert second L at 3
id = "4:l2"
afterId = crdt.getIdAtOffset(2)
console.log(`Insert 'L' at offset 3, afterId="${afterId}"`)
crdt.insert("L", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}\n`)

// Insert O at 4
id = "5:o"
afterId = crdt.getIdAtOffset(3)
console.log(`Insert 'O' at offset 4, afterId="${afterId}"`)
crdt.insert("O", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}\n`)

// Now insert X at position 2 (between E and first L)
id = "6:x"
afterId = crdt.getIdAtOffset(1)
console.log(`Insert 'X' at offset 2, afterId="${afterId}"`)
crdt.insert("X", afterId, id)
console.log(`  Text: "${crdt.getText()}"`)
console.log(`  getOffsetOfId('${id}'): ${crdt.getOffsetOfId(id)}`)
console.log(`\nExpected: "HEXLLO"`)
console.log(`Got: "${crdt.getText()}"`)

// Show tree structure
console.log("\nTree structure:")
const root = crdt.chars.get("ROOT")
console.log(`ROOT.right = [${root.right.join(", ")}]`)
function showNode(id, indent = ""){
  const node = crdt.chars.get(id)
  if(!node) return
  console.log(`${indent}${id}: value="${node.value}", right=[${node.right.join(", ")}]`)
  for(const childId of node.right){
    showNode(childId, indent + "  ")
  }
}
for(const childId of root.right){
  showNode(childId, "  ")
}

const CRDTText = require("../server/crdt/text")

console.log("Testing CRDT directly...\n")

const crdt = new CRDTText()

// Insert A at offset 0
console.log("1. Insert 'A' at offset 0")
const afterId1 = crdt.getIdAtOffset(-1)
console.log(`   afterId = ${afterId1}`)
const id1 = "1000:0.1"
crdt.insert("A", afterId1, id1)
const offset1 = crdt.getOffsetOfId(id1)
console.log(`   Calculated offset = ${offset1}`)
console.log(`   Text = "${crdt.getText()}"`)
console.log(`   Visible chars = ${crdt.getVisibleChars().length}\n`)

// Insert B at offset 1
console.log("2. Insert 'B' at offset 1")
const afterId2 = crdt.getIdAtOffset(0)
console.log(`   afterId = ${afterId2}`)
const id2 = "1001:0.2"
crdt.insert("B", afterId2, id2)
const offset2 = crdt.getOffsetOfId(id2)
console.log(`   Calculated offset = ${offset2}`)
console.log(`   Text = "${crdt.getText()}"`)
console.log(`   Visible chars = ${crdt.getVisibleChars().length}\n`)

// Insert X at offset 0
console.log("3. Insert 'X' at offset 0")
const afterId3 = crdt.getIdAtOffset(-1)
console.log(`   afterId = ${afterId3}`)
const id3 = "1000:0.3"
crdt.insert("X", afterId3, id3)
const offset3 = crdt.getOffsetOfId(id3)
console.log(`   Calculated offset = ${offset3}`)
console.log(`   Text = "${crdt.getText()}"`)
console.log(`   Visible chars = ${crdt.getVisibleChars().length}\n`)

// Debug: Show the CRDT structure
console.log("CRDT structure:")
const root = crdt.chars.get("ROOT")
console.log(`ROOT.right = [${root.right.join(", ")}]`)
for(const id of root.right){
  const node = crdt.chars.get(id)
  console.log(`  ${id}: value="${node.value}", right=[${node.right.join(", ")}]`)
  for(const childId of node.right){
    const child = crdt.chars.get(childId)
    console.log(`    ${childId}: value="${child.value}", right=[${child.right.join(", ")}]`)
  }
}

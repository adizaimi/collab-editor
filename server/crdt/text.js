class CRDTText {
  constructor() {
    this.root = "ROOT"
    this.chars = new Map()
    this.chars.set(this.root, {id:this.root, value:"", left:null, right:[], deleted:false})
  }

  insert(value, afterId, id){
    if(this.chars.has(id)) return
    const left = this.chars.get(afterId)
    if(!left) return
    const char = {id, value, left:afterId, right:[], deleted:false}
    this.chars.set(id,char)

    // Insert at the beginning of right array (most recent insertion wins position)
    // This ensures that when inserting at the same position, the latest insert appears first
    left.right.unshift(id)
  }

  delete(id){
    const node = this.chars.get(id)
    if(node) node.deleted = true
  }

  getText(){
    let out=""
    const visit=(id)=>{
      const node = this.chars.get(id)
      if(id!==this.root && !node.deleted) out+=node.value
      for(const c of node.right) visit(c)
    }
    visit(this.root)
    return out
  }

  getVisibleChars(){
    const result = []
    const visit = (id) => {
      const node = this.chars.get(id)
      if(id !== this.root && !node.deleted) {
        result.push(node)
      }
      for(const c of node.right) {
        visit(c)
      }
    }
    visit(this.root)
    return result
  }

  getIdAtOffset(offset){
    let i=-1, result=null
    const visit=(id)=>{
      const node = this.chars.get(id)
      if(id!==this.root && !node.deleted) i++
      if(i===offset){ result=id; return }
      for(const c of node.right){ if(!result) visit(c) }
    }
    visit(this.root)
    return result || this.root
  }

  getOffsetOfId(targetId){
    let offset = 0
    const visit = (id) => {
      if(id === targetId) return true
      const node = this.chars.get(id)
      if(id !== this.root && !node.deleted) offset++
      for(const c of node.right) {
        if(visit(c)) return true
      }
      return false
    }
    visit(this.root)
    return offset
  }

  findIdByValueAtOffset(value, targetOffset){
    let currentOffset = -1
    let result = null
    const visit = (id) => {
      const node = this.chars.get(id)
      if(id !== this.root && !node.deleted) {
        currentOffset++
        if(currentOffset === targetOffset && node.value === value) {
          result = id
          return true
        }
      }
      for(const c of node.right) {
        if(visit(c)) return true
      }
      return false
    }
    visit(this.root)
    return result
  }

  /**
   * Serialize CRDT state to JSON (for snapshots)
   */
  serialize() {
    const chars = Array.from(this.chars.entries()).map(([id, node]) => ({
      id,
      value: node.value,
      left: node.left,
      right: node.right,
      deleted: node.deleted
    }))
    return JSON.stringify({ root: this.root, chars })
  }

  /**
   * Deserialize CRDT state from JSON (for loading snapshots)
   */
  static deserialize(json) {
    const data = JSON.parse(json)
    const crdt = new CRDTText()
    crdt.root = data.root
    crdt.chars.clear()

    for (const node of data.chars) {
      crdt.chars.set(node.id, {
        id: node.id,
        value: node.value,
        left: node.left,
        right: node.right,
        deleted: node.deleted
      })
    }

    return crdt
  }
}

module.exports = CRDTText
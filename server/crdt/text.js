// server/crdt/text.js
class CRDTText {
  constructor() {
    this.root = "ROOT"
    this.chars = new Map()
    this.chars.set(this.root, {id:this.root, value:"", left:null, right:[], deleted:false})
  }

  insert(value, afterId, id) {
    if(this.chars.has(id)) return
    const left = this.chars.get(afterId)
    if(!left) return
    const char = {id, value, left:afterId, right:[], deleted:false}
    this.chars.set(id,char)
    left.right.push(id)
  }

  delete(id) {
    const node = this.chars.get(id)
    if(node) node.deleted = true
  }

  getText() {
    let out=""
    const visit = (id) => {
      const node = this.chars.get(id)
      if(id!==this.root && !node.deleted) out+=node.value
      for(const c of node.right) visit(c)
    }
    visit(this.root)
    return out
  }

  // helper: find the CRDT char ID at a visible offset
  getIdAtOffset(offset){
    let i=-1
    let result=null
    const visit=(id)=>{
      const node=this.chars.get(id)
      if(id!==this.root && !node.deleted) i++
      if(i===offset){ result=id; return }
      for(const c of node.right){ if(!result) visit(c) }
    }
    visit(this.root)
    return result || this.root
  }

  getVisibleChars(){
    return [...this.chars.values()].filter(c=>!c.deleted && c.id!==this.root)
  }
}

module.exports = CRDTText
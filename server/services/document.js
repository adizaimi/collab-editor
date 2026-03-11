const CRDTText = require("../crdt/text")

class DocumentService {
  constructor(storage){
    this.storage = storage
    this.docs = new Map()
  }

  loadDocument(docId){
    if(this.docs.has(docId)) return this.docs.get(docId)
    const crdt = new CRDTText()
    const ops = this.storage.loadOperations(docId)
    for(const r of ops){
      if(r.type==="insert") crdt.insert(r.value, r.after_id, r.op_id)
      if(r.type==="delete") crdt.delete(r.op_id)
    }
    this.docs.set(docId, crdt)
    return crdt
  }

  applyOperation(docId, op){
    const doc = this.loadDocument(docId)
    if(op.type==="insert") doc.insert(op.value, op.after, op.id)
    if(op.type==="delete") doc.delete(op.id)
    this.storage.saveOperation(docId, op)
  }

  getText(docId){
    return this.loadDocument(docId).getText()
  }

  getCRDT(docId){
    return this.loadDocument(docId)
  }
}

module.exports = DocumentService
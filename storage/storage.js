class Storage {
  async init() {}
  async getDocument(docId) {}
  async saveOperation(docId, op) {}
  async saveSnapshot(docId, content) {}
  async getLatestSnapshot(docId) {}
}

module.exports = Storage

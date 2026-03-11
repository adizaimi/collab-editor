const Database = require("better-sqlite3")
const Storage = require("./storage")

class SQLiteStorage extends Storage {
  constructor(path = "editor.db") {
    super()
    this.db = new Database(path)
  }

  async init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        content TEXT,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        op TEXT,
        created_at INTEGER
      );
    `)
  }

  async getLatestSnapshot(docId) {
    return this.db.prepare(`
      SELECT * FROM snapshots
      WHERE doc_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(docId)
  }

  async saveOperation(docId, op) {
    this.db.prepare(`
      INSERT INTO operations(doc_id, op, created_at)
      VALUES (?, ?, ?)
    `).run(docId, JSON.stringify(op), Date.now())
  }

  async saveSnapshot(docId, content) {
    this.db.prepare(`
      INSERT INTO snapshots(doc_id, content, created_at)
      VALUES (?, ?, ?)
    `).run(docId, content, Date.now())
  }

  async getDocument(docId) {
    const snap = await this.getLatestSnapshot(docId)
    return snap ? snap.content : ""
  }
}

module.exports = SQLiteStorage

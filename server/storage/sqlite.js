// server/storage/sqlite.js
const Database = require("better-sqlite3")
class SQLiteStorage {
  constructor(){ this.db = new Database("editor.db") }
  init(){
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations(
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        op_id TEXT,
        type TEXT,
        value TEXT,
        after_id TEXT,
        created_at INTEGER
      )
    `)
  }
  saveOperation(docId, op){
    this.db.prepare(`
      INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at)
      VALUES (?,?,?,?,?,?)
    `).run(docId, op.id, op.type, op.value||null, op.after||null, Date.now())
  }
  loadOperations(docId){
    return this.db.prepare(`SELECT * FROM operations WHERE doc_id=? ORDER BY id`).all(docId)
  }
}
module.exports = SQLiteStorage
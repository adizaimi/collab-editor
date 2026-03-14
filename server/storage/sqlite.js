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
      );

      CREATE INDEX IF NOT EXISTS idx_doc_operations
        ON operations(doc_id, created_at);

      CREATE TABLE IF NOT EXISTS snapshots(
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        content TEXT,
        created_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_doc_snapshots
        ON snapshots(doc_id, created_at DESC);
    `)
  }

  saveOperation(docId, op){
    // Handle both regular and batched operations
    const value = op.value || null
    const afterId = op.after || null

    this.db.prepare(`
      INSERT INTO operations (doc_id, op_id, type, value, after_id, created_at)
      VALUES (?,?,?,?,?,?)
    `).run(docId, op.id, op.type, value, afterId, Date.now())
  }

  loadOperations(docId){
    return this.db.prepare(`SELECT * FROM operations WHERE doc_id=? ORDER BY id`).all(docId)
  }

  saveSnapshot(docId, content, timestamp = Date.now()){
    this.db.prepare(`
      INSERT INTO snapshots (doc_id, content, created_at)
      VALUES (?,?,?)
    `).run(docId, content, timestamp)
  }

  loadLatestSnapshot(docId){
    return this.db.prepare(`
      SELECT * FROM snapshots
      WHERE doc_id=?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(docId)
  }

  loadOperationsSinceSnapshot(docId, snapshotTimestamp){
    return this.db.prepare(`
      SELECT * FROM operations
      WHERE doc_id=? AND created_at > ?
      ORDER BY id
    `).all(docId, snapshotTimestamp)
  }

  deleteOldOperations(docId, beforeTimestamp){
    this.db.prepare(`
      DELETE FROM operations
      WHERE doc_id=? AND created_at <= ?
    `).run(docId, beforeTimestamp)
  }

  getOperationCount(docId){
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM operations WHERE doc_id=?
    `).get(docId)
    return result.count
  }

  close(){
    if (this.db) {
      this.db.close()
      console.log('[SQLite] Database connection closed')
    }
  }
}

module.exports = SQLiteStorage
const Database = require("better-sqlite3")
class SQLiteStorage {
  constructor(){ this.db = new Database("editor.db") }
  init(){
    // Enable WAL mode for better concurrent read/write performance
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations(
        id INTEGER PRIMARY KEY,
        doc_id TEXT,
        op_id TEXT,
        type TEXT,
        value TEXT,
        after_id TEXT,
        attrs TEXT,
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

    // Migration: add attrs column if missing (for existing databases)
    try {
      this.db.exec(`ALTER TABLE operations ADD COLUMN attrs TEXT`)
    } catch (e) {
      // Column already exists - ignore
    }

    // Cache prepared statements for frequently used queries
    this._stmts = {
      insertOp: this.db.prepare(`
        INSERT INTO operations (doc_id, op_id, type, value, after_id, attrs, created_at)
        VALUES (?,?,?,?,?,?,?)
      `),
      loadOps: this.db.prepare(`SELECT * FROM operations WHERE doc_id=? ORDER BY id`),
      insertSnapshot: this.db.prepare(`
        INSERT INTO snapshots (doc_id, content, created_at)
        VALUES (?,?,?)
      `),
      loadLatestSnapshot: this.db.prepare(`
        SELECT * FROM snapshots
        WHERE doc_id=?
        ORDER BY created_at DESC
        LIMIT 1
      `),
      loadOpsSinceSnapshot: this.db.prepare(`
        SELECT * FROM operations
        WHERE doc_id=? AND created_at >= ?
        ORDER BY id
      `),
      deleteOldOps: this.db.prepare(`
        DELETE FROM operations
        WHERE doc_id=? AND created_at <= ?
      `),
      countOps: this.db.prepare(`
        SELECT COUNT(*) as count FROM operations WHERE doc_id=?
      `),
      listDocs: this.db.prepare(`
        SELECT doc_id, MAX(created_at) as last_updated
        FROM (
          SELECT doc_id, created_at FROM operations
          UNION ALL
          SELECT doc_id, created_at FROM snapshots
        )
        GROUP BY doc_id
        ORDER BY last_updated DESC
      `)
    }

    // Pre-compiled transaction for batch inserts
    this._insertBatch = this.db.transaction((docId, ops) => {
      const now = Date.now()
      for (const op of ops) {
        const attrs = op.attrs ? JSON.stringify(op.attrs) : null
        this._stmts.insertOp.run(docId, op.id, op.type, op.value != null ? op.value : null, op.after != null ? op.after : null, attrs, now)
      }
    })
  }

  saveOperation(docId, op){
    const value = op.value != null ? op.value : null
    const afterId = op.after != null ? op.after : null
    const attrs = op.attrs ? JSON.stringify(op.attrs) : null
    this._stmts.insertOp.run(docId, op.id, op.type, value, afterId, attrs, Date.now())
  }

  /**
   * Save multiple operations in a single transaction (much faster for batches).
   * @param {string} docId - Document ID
   * @param {Array} ops - Array of operation objects
   */
  saveOperationBatch(docId, ops){
    this._insertBatch(docId, ops)
  }

  loadOperations(docId){
    return this._stmts.loadOps.all(docId)
  }

  saveSnapshot(docId, content, timestamp = Date.now()){
    this._stmts.insertSnapshot.run(docId, content, timestamp)
  }

  loadLatestSnapshot(docId){
    return this._stmts.loadLatestSnapshot.get(docId)
  }

  loadOperationsSinceSnapshot(docId, snapshotTimestamp){
    return this._stmts.loadOpsSinceSnapshot.all(docId, snapshotTimestamp)
  }

  deleteOldOperations(docId, beforeTimestamp){
    this._stmts.deleteOldOps.run(docId, beforeTimestamp)
  }

  getOperationCount(docId){
    const result = this._stmts.countOps.get(docId)
    return result.count
  }

  listDocuments(){
    return this._stmts.listDocs.all()
  }

  close(){
    if (this.db) {
      this.db.close()
      console.log('[SQLite] Database connection closed')
    }
  }
}

module.exports = SQLiteStorage

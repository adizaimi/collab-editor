/**
 * SQLiteMetrics - Persistent metrics storage using SQLite
 *
 * Features:
 * - Separate database file (metrics.db)
 * - Time-series data with automatic cleanup
 * - Efficient indexing for fast queries
 * - Aggregation functions (count, avg, min, max, percentiles)
 * - Label-based filtering
 */

const Database = require('better-sqlite3')
const MetricsInterface = require('./metrics-interface')

class SQLiteMetrics extends MetricsInterface {
  constructor(options = {}) {
    super()

    this.dbPath = options.file || 'metrics.db'
    this.retentionDays = options.retentionDays || 7  // Keep 7 days by default
    this.db = new Database(this.dbPath)

    this._init()

    // Cleanup old metrics periodically (every hour)
    this.cleanupInterval = setInterval(() => {
      this._cleanup()
    }, 60 * 60 * 1000)
  }

  _init() {
    this.db.exec(`
      -- Metrics table (time-series data)
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,           -- Unix timestamp in ms
        metric TEXT NOT NULL,                  -- Metric name
        type TEXT NOT NULL,                    -- gauge, counter, histogram
        value REAL NOT NULL,                   -- Metric value
        labels TEXT,                           -- JSON-encoded labels
        created_at INTEGER NOT NULL
      );

      -- Indexes for fast queries
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp
        ON metrics(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_metrics_metric_timestamp
        ON metrics(metric, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_metrics_type_metric
        ON metrics(type, metric);

      -- Counters table (cumulative counters)
      CREATE TABLE IF NOT EXISTS counters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL,
        labels TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        last_updated INTEGER NOT NULL,
        UNIQUE(metric, labels)
      );

      CREATE INDEX IF NOT EXISTS idx_counters_metric
        ON counters(metric);
    `)

    console.log(`[Metrics] Initialized SQLite metrics: ${this.dbPath}`)
  }

  record(metric, value, labels = {}) {
    const labelsJson = Object.keys(labels).length > 0 ? JSON.stringify(labels) : null

    this.db.prepare(`
      INSERT INTO metrics (timestamp, metric, type, value, labels, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      metric,
      'gauge',
      value,
      labelsJson,
      Date.now()
    )
  }

  increment(metric, labels = {}, amount = 1) {
    const labelsJson = Object.keys(labels).length > 0 ? JSON.stringify(labels) : null

    // Use upsert to maintain cumulative counter
    this.db.prepare(`
      INSERT INTO counters (metric, labels, count, last_updated)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(metric, labels)
      DO UPDATE SET
        count = count + ?,
        last_updated = ?
    `).run(
      metric,
      labelsJson,
      amount,
      Date.now(),
      amount,
      Date.now()
    )

    // Also record in time-series for graphing
    this.db.prepare(`
      INSERT INTO metrics (timestamp, metric, type, value, labels, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      metric,
      'counter',
      amount,
      labelsJson,
      Date.now()
    )
  }

  timing(metric, durationMs, labels = {}) {
    const labelsJson = Object.keys(labels).length > 0 ? JSON.stringify(labels) : null

    this.db.prepare(`
      INSERT INTO metrics (timestamp, metric, type, value, labels, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      metric,
      'histogram',
      durationMs,
      labelsJson,
      Date.now()
    )
  }

  async query(query = {}) {
    const {
      metric,
      type,
      labels,
      startTime,
      endTime,
      limit = 1000
    } = query

    let sql = 'SELECT * FROM metrics WHERE 1=1'
    const params = []

    if (metric) {
      sql += ' AND metric = ?'
      params.push(metric)
    }

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    if (labels) {
      // Simple label matching (contains JSON)
      for (const [key, value] of Object.entries(labels)) {
        sql += ` AND labels LIKE ?`
        params.push(`%"${key}":"${value}"%`)
      }
    }

    if (startTime) {
      sql += ' AND timestamp >= ?'
      params.push(startTime)
    }

    if (endTime) {
      sql += ' AND timestamp <= ?'
      params.push(endTime)
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)

    const results = this.db.prepare(sql).all(...params)

    // Parse labels JSON
    return results.map(row => ({
      ...row,
      labels: row.labels ? JSON.parse(row.labels) : {}
    }))
  }

  async getStats(metric, options = {}) {
    const {
      startTime = Date.now() - (24 * 60 * 60 * 1000), // Default: last 24h
      endTime = Date.now(),
      labels = {},
      groupBy = null  // 'hour', 'minute', '5min'
    } = options

    let sql = `
      SELECT
        COUNT(*) as count,
        AVG(value) as avg,
        MIN(value) as min,
        MAX(value) as max,
        SUM(value) as sum
      FROM metrics
      WHERE metric = ?
        AND timestamp >= ?
        AND timestamp <= ?
    `
    const params = [metric, startTime, endTime]

    // Add label filters
    for (const [key, value] of Object.entries(labels)) {
      sql += ` AND labels LIKE ?`
      params.push(`%"${key}":"${value}"%`)
    }

    const stats = this.db.prepare(sql).get(...params)

    // Get percentiles (p50, p95, p99)
    const percentiles = this._getPercentiles(metric, startTime, endTime, labels)

    // Get time series data if groupBy specified
    let timeSeries = null
    if (groupBy) {
      timeSeries = this._getTimeSeries(metric, startTime, endTime, labels, groupBy)
    }

    // Get counter totals
    let counterTotal = null
    if (labels && Object.keys(labels).length > 0) {
      const labelsJson = JSON.stringify(labels)
      const counter = this.db.prepare(`
        SELECT count FROM counters
        WHERE metric = ? AND labels = ?
      `).get(metric, labelsJson)
      counterTotal = counter ? counter.count : 0
    } else {
      const counter = this.db.prepare(`
        SELECT SUM(count) as total FROM counters
        WHERE metric = ?
      `).get(metric)
      counterTotal = counter ? counter.total : 0
    }

    return {
      metric,
      timeRange: { start: startTime, end: endTime },
      stats: {
        count: stats.count || 0,
        avg: stats.avg || 0,
        min: stats.min || 0,
        max: stats.max || 0,
        sum: stats.sum || 0
      },
      percentiles,
      counterTotal,
      timeSeries
    }
  }

  _getPercentiles(metric, startTime, endTime, labels) {
    let sql = `
      SELECT value FROM metrics
      WHERE metric = ?
        AND timestamp >= ?
        AND timestamp <= ?
    `
    const params = [metric, startTime, endTime]

    for (const [key, value] of Object.entries(labels)) {
      sql += ` AND labels LIKE ?`
      params.push(`%"${key}":"${value}"%`)
    }

    sql += ' ORDER BY value ASC'

    const values = this.db.prepare(sql).all(...params).map(r => r.value)

    if (values.length === 0) {
      return { p50: 0, p95: 0, p99: 0 }
    }

    return {
      p50: values[Math.floor(values.length * 0.50)] || 0,
      p95: values[Math.floor(values.length * 0.95)] || 0,
      p99: values[Math.floor(values.length * 0.99)] || 0
    }
  }

  _getTimeSeries(metric, startTime, endTime, labels, groupBy) {
    // Determine bucket size in milliseconds
    const bucketMs = {
      'minute': 60 * 1000,
      '5min': 5 * 60 * 1000,
      'hour': 60 * 60 * 1000,
      'day': 24 * 60 * 60 * 1000
    }[groupBy] || 60 * 1000

    let sql = `
      SELECT
        (timestamp / ${bucketMs}) * ${bucketMs} as bucket,
        COUNT(*) as count,
        AVG(value) as avg,
        MIN(value) as min,
        MAX(value) as max
      FROM metrics
      WHERE metric = ?
        AND timestamp >= ?
        AND timestamp <= ?
    `
    const params = [metric, startTime, endTime]

    for (const [key, value] of Object.entries(labels)) {
      sql += ` AND labels LIKE ?`
      params.push(`%"${key}":"${value}"%`)
    }

    sql += ' GROUP BY bucket ORDER BY bucket ASC'

    return this.db.prepare(sql).all(...params)
  }

  /**
   * Get all unique metric names
   */
  getMetricNames() {
    const results = this.db.prepare(`
      SELECT DISTINCT metric FROM metrics
      ORDER BY metric
    `).all()

    return results.map(r => r.metric)
  }

  /**
   * Get summary of all metrics
   */
  getSummary() {
    const summary = this.db.prepare(`
      SELECT
        metric,
        type,
        COUNT(*) as count,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM metrics
      GROUP BY metric, type
      ORDER BY last_seen DESC
    `).all()

    const counters = this.db.prepare(`
      SELECT metric, SUM(count) as total
      FROM counters
      GROUP BY metric
    `).all()

    const dbSize = this.db.prepare(`
      SELECT page_count * page_size as size
      FROM pragma_page_count(), pragma_page_size()
    `).get()

    return {
      metrics: summary,
      counters,
      database: {
        size: dbSize.size,
        sizeHuman: this._formatBytes(dbSize.size),
        path: this.dbPath
      }
    }
  }

  /**
   * Get breakdown by labels for a specific metric
   */
  getBreakdown(metric, options = {}) {
    const {
      startTime = Date.now() - (24 * 60 * 60 * 1000),
      endTime = Date.now(),
      limit = 100
    } = options

    // Get all records for this metric
    const records = this.db.prepare(`
      SELECT labels, COUNT(*) as count, AVG(value) as avg, SUM(value) as sum
      FROM metrics
      WHERE metric = ?
        AND timestamp >= ?
        AND timestamp <= ?
        AND labels IS NOT NULL
      GROUP BY labels
      ORDER BY count DESC
      LIMIT ?
    `).all(metric, startTime, endTime, limit)

    // Parse labels and format results
    const breakdown = records.map(row => ({
      labels: JSON.parse(row.labels),
      count: row.count,
      avg: row.avg,
      sum: row.sum
    }))

    // Also get counter breakdowns
    const counterBreakdown = this.db.prepare(`
      SELECT labels, count
      FROM counters
      WHERE metric = ?
        AND labels IS NOT NULL
      ORDER BY count DESC
      LIMIT ?
    `).all(metric, limit)

    const counterResults = counterBreakdown.map(row => ({
      labels: JSON.parse(row.labels),
      count: row.count
    }))

    return {
      metric,
      timeRange: { start: startTime, end: endTime },
      breakdown,
      counterBreakdown: counterResults
    }
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  /**
   * Cleanup old metrics based on retention policy
   */
  _cleanup() {
    const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000)

    const result = this.db.prepare(`
      DELETE FROM metrics WHERE timestamp < ?
    `).run(cutoffTime)

    if (result.changes > 0) {
      console.log(`[Metrics] Cleaned up ${result.changes} old metrics (older than ${this.retentionDays} days)`)

      // Vacuum to reclaim space
      this.db.exec('VACUUM')
    }
  }

  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    if (this.db) {
      this.db.close()
      console.log('[Metrics] Closed SQLite metrics database')
    }
  }
}

module.exports = SQLiteMetrics

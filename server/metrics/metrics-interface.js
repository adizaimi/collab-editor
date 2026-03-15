/**
 * MetricsInterface - Base interface for metrics collection
 *
 * This allows swapping between different metrics backends:
 * - SQLiteMetrics (persistent, queryable)
 * - MemoryMetrics (fast, ephemeral)
 * - FileMetrics (simple, append-only)
 * - PrometheusMetrics (production monitoring)
 */

class MetricsInterface {
  /**
   * Record a gauge metric (point-in-time value)
   * @param {string} metric - Metric name (e.g., 'queue.pending')
   * @param {number} value - Metric value
   * @param {object} labels - Labels/tags (e.g., {doc_id: 'doc1'})
   */
  record(metric, value, labels = {}) {
    throw new Error('Not implemented: record()')
  }

  /**
   * Increment a counter metric
   * @param {string} metric - Metric name (e.g., 'operations.total')
   * @param {object} labels - Labels/tags
   * @param {number} amount - Amount to increment (default 1)
   */
  increment(metric, labels = {}, amount = 1) {
    throw new Error('Not implemented: increment()')
  }

  /**
   * Record a timing/duration metric
   * @param {string} metric - Metric name (e.g., 'operations.latency')
   * @param {number} durationMs - Duration in milliseconds
   * @param {object} labels - Labels/tags
   */
  timing(metric, durationMs, labels = {}) {
    throw new Error('Not implemented: timing()')
  }

  /**
   * Query metrics
   * @param {object} query - Query parameters
   * @returns {Promise<Array>} - Matching metrics
   */
  async query(query) {
    throw new Error('Not implemented: query()')
  }

  /**
   * Get aggregated statistics
   * @param {string} metric - Metric name
   * @param {object} options - Aggregation options (time range, labels, etc.)
   * @returns {Promise<object>} - Aggregated stats
   */
  async getStats(metric, options = {}) {
    throw new Error('Not implemented: getStats()')
  }

  /**
   * Cleanup/flush metrics
   */
  async close() {
    // Optional - implement if needed
  }
}

module.exports = MetricsInterface

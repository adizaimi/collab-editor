#!/usr/bin/env node
/**
 * Metrics CLI - View and analyze metrics from command line
 *
 * Usage:
 *   node metrics-cli.js summary
 *   node metrics-cli.js list
 *   node metrics-cli.js query operations.total
 *   node metrics-cli.js stats operations.latency --last 1h
 *   node metrics-cli.js stats queue.pending --last 24h --group hour
 *   node metrics-cli.js top
 */

const SQLiteMetrics = require('./sqlite-metrics')
const path = require('path')

const metrics = new SQLiteMetrics({ file: path.join(__dirname, '../../metrics.db') })

const commands = {
  async summary() {
    console.log('\n📊 METRICS SUMMARY\n' + '='.repeat(70))

    const summary = metrics.getSummary()

    console.log(`\n📁 Database: ${summary.database.path}`)
    console.log(`   Size: ${summary.database.sizeHuman}`)

    console.log('\n📈 Metrics:')
    console.log('─'.repeat(70))
    console.log(sprintf('%-30s %-12s %-10s %-20s', 'Metric', 'Type', 'Count', 'Last Seen'))
    console.log('─'.repeat(70))

    for (const m of summary.metrics) {
      const lastSeen = new Date(m.last_seen).toLocaleString()
      console.log(sprintf('%-30s %-12s %-10s %-20s',
        m.metric.substring(0, 30),
        m.type,
        m.count.toLocaleString(),
        lastSeen.substring(0, 20)
      ))
    }

    if (summary.counters.length > 0) {
      console.log('\n🔢 Counters:')
      console.log('─'.repeat(70))
      for (const c of summary.counters) {
        console.log(sprintf('%-40s %s', c.metric, c.total.toLocaleString()))
      }
    }

    // Show breakdowns for key metrics
    console.log('\n📊 Key Metric Breakdowns (Last 24h):')
    console.log('─'.repeat(70))

    // Operations breakdown
    const opsBreakdown = metrics.getBreakdown('operations.total', {
      startTime: Date.now() - (24 * 60 * 60 * 1000)
    })

    if (opsBreakdown.counterBreakdown.length > 0) {
      console.log('\n  Operations by Type & Document:')
      for (const item of opsBreakdown.counterBreakdown.slice(0, 10)) {
        const type = item.labels.type || '?'
        const docId = item.labels.doc_id || '?'
        console.log(sprintf('    %-15s %-20s %s', type, docId, item.count.toLocaleString()))
      }
      if (opsBreakdown.counterBreakdown.length > 10) {
        console.log(`    ... and ${opsBreakdown.counterBreakdown.length - 10} more`)
      }
    }

    // Connections by document
    const connBreakdown = metrics.getBreakdown('connections.by_document', {
      startTime: Date.now() - (24 * 60 * 60 * 1000)
    })

    if (connBreakdown.counterBreakdown.length > 0) {
      console.log('\n  Connections by Document:')
      for (const item of connBreakdown.counterBreakdown.slice(0, 10)) {
        const docId = item.labels.doc_id || '?'
        console.log(sprintf('    %-30s %s', docId, item.count.toLocaleString()))
      }
      if (connBreakdown.counterBreakdown.length > 10) {
        console.log(`    ... and ${connBreakdown.counterBreakdown.length - 10} more`)
      }
    }

    // Document sizes
    const docSizes = metrics.getBreakdown('document.text_length', {
      startTime: Date.now() - (60 * 60 * 1000) // Last hour
    })

    if (docSizes.breakdown.length > 0) {
      console.log('\n  Document Sizes (chars):')
      for (const item of docSizes.breakdown.slice(0, 10)) {
        const docId = item.labels.doc_id || '?'
        console.log(sprintf('    %-30s %s chars (avg)', docId, Math.round(item.avg).toLocaleString()))
      }
    }

    console.log('\n💡 Tip: Use "breakdown <metric>" for detailed label analysis')
    console.log('   Examples:')
    console.log('     npm run metrics breakdown operations.total')
    console.log('     npm run metrics breakdown operations.latency --last 1h')

    console.log()
  },

  async list() {
    const metricNames = metrics.getMetricNames()

    console.log('\n📋 AVAILABLE METRICS\n' + '='.repeat(70))
    console.log(`Total: ${metricNames.length}\n`)

    for (const name of metricNames) {
      console.log(`  • ${name}`)
    }

    console.log()
  },

  async query(metricName, options = {}) {
    if (!metricName) {
      console.error('❌ Error: Metric name required')
      console.log('Usage: node metrics-cli.js query <metric-name>')
      return
    }

    const timeRange = parseTimeRange(options.last || '1h')
    const limit = parseInt(options.limit) || 100

    console.log(`\n🔍 QUERY: ${metricName}\n` + '='.repeat(70))
    console.log(`Time range: ${new Date(timeRange.start).toLocaleString()} - ${new Date(timeRange.end).toLocaleString()}`)
    console.log(`Limit: ${limit}\n`)

    const results = await metrics.query({
      metric: metricName,
      startTime: timeRange.start,
      endTime: timeRange.end,
      limit
    })

    if (results.length === 0) {
      console.log('No data found')
      return
    }

    console.log(sprintf('%-20s %-12s %-15s %s', 'Timestamp', 'Value', 'Type', 'Labels'))
    console.log('─'.repeat(70))

    for (const row of results.slice(0, 20)) {
      const timestamp = new Date(row.timestamp).toLocaleTimeString()
      const labelsStr = Object.keys(row.labels).length > 0
        ? JSON.stringify(row.labels)
        : '-'

      console.log(sprintf('%-20s %-12s %-15s %s',
        timestamp,
        row.value.toFixed(2),
        row.type,
        labelsStr.substring(0, 30)
      ))
    }

    if (results.length > 20) {
      console.log(`... and ${results.length - 20} more`)
    }

    console.log()
  },

  async stats(metricName, options = {}) {
    if (!metricName) {
      console.error('❌ Error: Metric name required')
      console.log('Usage: node metrics-cli.js stats <metric-name> [--last 1h] [--group hour]')
      return
    }

    const timeRange = parseTimeRange(options.last || '24h')
    const groupBy = options.group || null

    console.log(`\n📊 STATISTICS: ${metricName}\n` + '='.repeat(70))

    const stats = await metrics.getStats(metricName, {
      startTime: timeRange.start,
      endTime: timeRange.end,
      groupBy
    })

    console.log(`Time range: ${new Date(stats.timeRange.start).toLocaleString()} - ${new Date(stats.timeRange.end).toLocaleString()}\n`)

    console.log('Summary:')
    console.log(`  Count:   ${stats.stats.count.toLocaleString()}`)
    console.log(`  Average: ${stats.stats.avg.toFixed(2)}`)
    console.log(`  Min:     ${stats.stats.min.toFixed(2)}`)
    console.log(`  Max:     ${stats.stats.max.toFixed(2)}`)
    console.log(`  Sum:     ${stats.stats.sum.toFixed(2)}`)

    if (stats.counterTotal !== null) {
      console.log(`\n  Total (counter): ${stats.counterTotal.toLocaleString()}`)
    }

    if (stats.percentiles) {
      console.log('\nPercentiles:')
      console.log(`  p50: ${stats.percentiles.p50.toFixed(2)}`)
      console.log(`  p95: ${stats.percentiles.p95.toFixed(2)}`)
      console.log(`  p99: ${stats.percentiles.p99.toFixed(2)}`)
    }

    if (stats.timeSeries && stats.timeSeries.length > 0) {
      console.log(`\nTime Series (grouped by ${groupBy}):`)
      console.log('─'.repeat(70))
      console.log(sprintf('%-25s %-10s %-10s %-10s %-10s', 'Time', 'Count', 'Avg', 'Min', 'Max'))
      console.log('─'.repeat(70))

      for (const point of stats.timeSeries.slice(-20)) {
        const time = new Date(point.bucket).toLocaleString()
        console.log(sprintf('%-25s %-10s %-10s %-10s %-10s',
          time,
          point.count,
          point.avg.toFixed(2),
          point.min.toFixed(2),
          point.max.toFixed(2)
        ))
      }

      if (stats.timeSeries.length > 20) {
        console.log(`... and ${stats.timeSeries.length - 20} more buckets`)
      }
    }

    console.log()
  },

  async top(options = {}) {
    const timeRange = parseTimeRange(options.last || '1h')

    console.log('\n🔝 TOP METRICS (Last Hour)\n' + '='.repeat(70))

    const metricNames = metrics.getMetricNames()
    const topMetrics = []

    for (const name of metricNames) {
      const stats = await metrics.getStats(name, {
        startTime: timeRange.start,
        endTime: timeRange.end
      })

      topMetrics.push({
        name,
        count: stats.stats.count,
        avg: stats.stats.avg,
        max: stats.stats.max
      })
    }

    // Sort by count descending
    topMetrics.sort((a, b) => b.count - a.count)

    console.log(sprintf('%-35s %-12s %-12s %-12s', 'Metric', 'Count', 'Avg', 'Max'))
    console.log('─'.repeat(70))

    for (const m of topMetrics.slice(0, 20)) {
      console.log(sprintf('%-35s %-12s %-12s %-12s',
        m.name.substring(0, 35),
        m.count.toLocaleString(),
        m.avg.toFixed(2),
        m.max.toFixed(2)
      ))
    }

    console.log()
  },

  async breakdown(metricName, options = {}) {
    if (!metricName) {
      console.error('❌ Error: Metric name required')
      console.log('Usage: node metrics-cli.js breakdown <metric-name> [--last 1h]')
      return
    }

    const timeRange = parseTimeRange(options.last || '24h')

    console.log(`\n🔍 BREAKDOWN: ${metricName}\n` + '='.repeat(70))
    console.log(`Time range: ${new Date(timeRange.start).toLocaleString()} - ${new Date(timeRange.end).toLocaleString()}\n`)

    const result = metrics.getBreakdown(metricName, {
      startTime: timeRange.start,
      endTime: timeRange.end
    })

    if (result.counterBreakdown.length > 0) {
      console.log('📊 Counter Breakdown:')
      console.log('─'.repeat(70))
      console.log(sprintf('%-50s %s', 'Labels', 'Total'))
      console.log('─'.repeat(70))

      for (const item of result.counterBreakdown) {
        const labelsStr = JSON.stringify(item.labels)
        console.log(sprintf('%-50s %s',
          labelsStr.substring(0, 50),
          item.count.toLocaleString()
        ))
      }
      console.log()
    }

    if (result.breakdown.length > 0) {
      console.log('📈 Time-Series Breakdown:')
      console.log('─'.repeat(70))
      console.log(sprintf('%-40s %-12s %-12s %s', 'Labels', 'Count', 'Avg', 'Sum'))
      console.log('─'.repeat(70))

      for (const item of result.breakdown.slice(0, 20)) {
        const labelsStr = JSON.stringify(item.labels)
        console.log(sprintf('%-40s %-12s %-12s %s',
          labelsStr.substring(0, 40),
          item.count.toLocaleString(),
          item.avg.toFixed(2),
          item.sum.toFixed(2)
        ))
      }

      if (result.breakdown.length > 20) {
        console.log(`... and ${result.breakdown.length - 20} more`)
      }
    }

    if (result.counterBreakdown.length === 0 && result.breakdown.length === 0) {
      console.log('No label data found for this metric')
    }

    console.log()
  }
}

// Helper functions
function parseTimeRange(timeStr) {
  const now = Date.now()
  const matches = timeStr.match(/^(\d+)([smhd])$/)

  if (!matches) {
    return { start: now - (60 * 60 * 1000), end: now } // Default: 1 hour
  }

  const amount = parseInt(matches[1])
  const unit = matches[2]

  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  }

  const duration = amount * multipliers[unit]

  return {
    start: now - duration,
    end: now
  }
}

function sprintf(format, ...args) {
  let i = 0
  return format.replace(/%(-)?(\d+)?s/g, (match, leftAlign, width) => {
    let str = String(args[i++] || '')
    width = parseInt(width) || 0

    if (width > 0) {
      if (leftAlign) {
        str = str.padEnd(width)
      } else {
        str = str.padStart(width)
      }
    }

    return str
  })
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'summary'
  const metricName = args[1]

  // Parse options (--last 1h, --group hour, etc.)
  const options = {}
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2)
      const value = args[i + 1]
      options[key] = value
      i++
    }
  }

  if (!commands[command]) {
    console.error(`❌ Unknown command: ${command}`)
    console.log('\nAvailable commands:')
    console.log('  summary              - Show metrics summary with key breakdowns')
    console.log('  list                 - List all metric names')
    console.log('  query <metric>       - Query raw metric data')
    console.log('  stats <metric>       - Show statistics for metric')
    console.log('  breakdown <metric>   - Show breakdown by labels (type, doc_id, etc.)')
    console.log('  top                  - Show top metrics by activity')
    console.log('\nOptions:')
    console.log('  --last <time>        - Time range (e.g., 1h, 30m, 7d)')
    console.log('  --group <unit>       - Group by (minute, 5min, hour, day)')
    console.log('  --limit <n>          - Limit results')
    console.log('\nExamples:')
    console.log('  npm run metrics summary')
    console.log('  npm run metrics breakdown operations.total')
    console.log('  npm run metrics breakdown operations.latency --last 1h')
    console.log('  npm run metrics stats queue.pending --last 24h --group hour')
    process.exit(1)
  }

  try {
    await commands[command](metricName, options)
    await metrics.close()
  } catch (error) {
    console.error('❌ Error:', error.message)
    await metrics.close()
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main()
}

module.exports = { commands, parseTimeRange }

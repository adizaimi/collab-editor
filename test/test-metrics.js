/**
 * Quick test to verify metrics system works
 */

const SQLiteMetrics = require('../server/metrics/sqlite-metrics')
const fs = require('fs')
const path = require('path')

const testDbPath = path.join(__dirname, 'test-metrics.db')

// Clean up before test
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath)
}

async function testMetrics() {
  console.log('Testing Metrics System...\n')

  const metrics = new SQLiteMetrics({
    file: testDbPath,
    retentionDays: 7
  })

  // Test 1: Record metrics
  console.log('✓ Recording metrics...')
  metrics.record('test.gauge', 100, { test: 'value' })
  metrics.increment('test.counter', { test: 'value' })
  metrics.increment('test.counter', { test: 'value' })
  metrics.timing('test.latency', 42.5, { test: 'value' })
  metrics.timing('test.latency', 38.2, { test: 'value' })
  metrics.timing('test.latency', 51.3, { test: 'value' })

  // Test 2: Query metrics
  console.log('✓ Querying metrics...')
  const results = await metrics.query({
    metric: 'test.latency',
    limit: 10
  })
  console.log(`  Found ${results.length} metric entries`)

  // Test 3: Get stats
  console.log('✓ Getting statistics...')
  const stats = await metrics.getStats('test.latency')
  console.log(`  Count: ${stats.stats.count}`)
  console.log(`  Avg: ${stats.stats.avg.toFixed(2)}`)
  console.log(`  Min: ${stats.stats.min.toFixed(2)}`)
  console.log(`  Max: ${stats.stats.max.toFixed(2)}`)
  console.log(`  p50: ${stats.percentiles.p50.toFixed(2)}`)

  // Test 4: Get summary
  console.log('✓ Getting summary...')
  const summary = metrics.getSummary()
  console.log(`  Total metrics: ${summary.metrics.length}`)
  console.log(`  Database size: ${summary.database.sizeHuman}`)

  // Test 5: List metric names
  console.log('✓ Listing metric names...')
  const names = metrics.getMetricNames()
  console.log(`  Unique metrics: ${names.length}`)
  names.forEach(name => console.log(`    - ${name}`))

  // Cleanup
  await metrics.close()

  console.log('\n✅ All metrics tests passed!')

  // Cleanup test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }
}

testMetrics().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})

#!/usr/bin/env node

const { spawn } = require("child_process")
const path = require("path")

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
}

// Test suite configuration
const testSuites = [
  {
    name: "CRDT Unit Tests",
    path: path.join(__dirname, "unit/crdt.test.js"),
    type: "unit"
  },
  {
    name: "DocumentService Unit Tests",
    path: path.join(__dirname, "unit/document-service.test.js"),
    type: "unit"
  },
  {
    name: "SQLiteStorage Unit Tests",
    path: path.join(__dirname, "unit/sqlite-storage.test.js"),
    type: "unit"
  },
  {
    name: "OperationBuffer Unit Tests",
    path: path.join(__dirname, "unit/operation-buffer.test.js"),
    type: "unit"
  },
  {
    name: "Snapshot System Unit Tests",
    path: path.join(__dirname, "unit/snapshot.test.js"),
    type: "unit"
  },
  {
    name: "Additional CRDT Unit Tests",
    path: path.join(__dirname, "unit/crdt-additional.test.js"),
    type: "unit"
  },
  {
    name: "OperationQueue Unit Tests",
    path: path.join(__dirname, "unit/operation-queue.test.js"),
    type: "unit"
  },
  {
    name: "Large Document Unit Tests",
    path: path.join(__dirname, "unit/large-document.test.js"),
    type: "unit"
  },
  {
    name: "Server-Client E2E Tests",
    path: path.join(__dirname, "e2e/server-client.test.js"),
    type: "e2e"
  },
  {
    name: "Presence, Colors & Cursor E2E Tests",
    path: path.join(__dirname, "e2e/presence-cursor.test.js"),
    type: "e2e"
  }
]

// Run a single test file
function runTest(testSuite) {
  return new Promise((resolve) => {
    const startTime = Date.now()
    console.log(`\n${colors.cyan}Running: ${testSuite.name}${colors.reset}`)
    console.log(`${colors.blue}File: ${testSuite.path}${colors.reset}`)
    console.log("-".repeat(60))

    const child = spawn("node", [testSuite.path], {
      stdio: "inherit",
      cwd: path.dirname(testSuite.path)
    })

    child.on("close", (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      const status = code === 0 ? "PASSED" : "FAILED"
      const statusColor = code === 0 ? colors.green : colors.red

      console.log(`\n${statusColor}${status}${colors.reset} in ${duration}s`)

      resolve({
        name: testSuite.name,
        passed: code === 0,
        duration: duration,
        type: testSuite.type
      })
    })

    child.on("error", (err) => {
      console.error(`${colors.red}Error running test:${colors.reset}`, err.message)
      resolve({
        name: testSuite.name,
        passed: false,
        duration: 0,
        type: testSuite.type,
        error: err.message
      })
    })
  })
}

// Main test runner
async function runAllTests() {
  console.log(colors.bright + "=".repeat(60))
  console.log("     COLLABORATIVE DOCUMENT EDITOR - TEST SUITE")
  console.log("=".repeat(60) + colors.reset)
  console.log(`Total Test Suites: ${testSuites.length}`)
  console.log(`Unit Tests: ${testSuites.filter(t => t.type === "unit").length}`)
  console.log(`E2E Tests: ${testSuites.filter(t => t.type === "e2e").length}`)

  const results = []
  const startTime = Date.now()

  // Run all test suites sequentially
  for (const testSuite of testSuites) {
    const result = await runTest(testSuite)
    results.push(result)
  }

  // Print summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2)
  const passedCount = results.filter(r => r.passed).length
  const failedCount = results.filter(r => !r.passed).length

  console.log("\n" + colors.bright + "=".repeat(60))
  console.log("                    TEST SUMMARY")
  console.log("=".repeat(60) + colors.reset)

  // Print results by type
  console.log(`\n${colors.cyan}Unit Tests:${colors.reset}`)
  results.filter(r => r.type === "unit").forEach(r => {
    const status = r.passed ? `${colors.green}✅ PASSED${colors.reset}` : `${colors.red}❌ FAILED${colors.reset}`
    console.log(`  ${status} - ${r.name} (${r.duration}s)`)
  })

  console.log(`\n${colors.cyan}End-to-End Tests:${colors.reset}`)
  results.filter(r => r.type === "e2e").forEach(r => {
    const status = r.passed ? `${colors.green}✅ PASSED${colors.reset}` : `${colors.red}❌ FAILED${colors.reset}`
    console.log(`  ${status} - ${r.name} (${r.duration}s)`)
  })

  console.log("\n" + colors.bright + "=".repeat(60))
  console.log(`Total Suites: ${results.length}`)
  console.log(`${colors.green}Passed: ${passedCount}${colors.reset}`)
  console.log(`${colors.red}Failed: ${failedCount}${colors.reset}`)
  console.log(`Duration: ${totalDuration}s`)
  console.log("=".repeat(60) + colors.reset)

  if (failedCount > 0) {
    console.log(`\n${colors.red}${colors.bright}Some tests failed!${colors.reset}`)
    console.log("\nFailed suites:")
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${colors.red}• ${r.name}${colors.reset}`)
      if (r.error) {
        console.log(`    Error: ${r.error}`)
      }
    })
    process.exit(1)
  } else {
    console.log(`\n${colors.green}${colors.bright}All tests passed! 🎉${colors.reset}`)
    process.exit(0)
  }
}

// Run tests
runAllTests().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err)
  process.exit(1)
})

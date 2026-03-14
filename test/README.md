# Test Suite

This directory contains all tests for the Collaborative Document Editor.

## Directory Structure

```
test/
├── unit/                    # Unit tests (automated)
│   ├── crdt.test.js                  # CRDT data structure (21 tests, 55 assertions)
│   ├── document-service.test.js      # Document management (13 tests, 28 assertions)
│   └── sqlite-storage.test.js        # Database operations (13 tests, 42 assertions)
├── e2e/                     # End-to-end tests (automated)
│   └── server-client.test.js         # Integration tests (12 tests, 16 assertions)
├── manual/                  # Manual browser tests
│   ├── backspace-delete-test.html    # Keyboard input test
│   ├── manual-test.html              # Server-client test page
│   └── README.md                     # Manual test docs
├── examples/                # Example/debug scripts
│   ├── concurrent-test.js            # Concurrent editing example
│   ├── middle-insert-test.js         # Insert in middle example
│   ├── replace-test.js               # Text replacement example
│   ├── simple-test.js                # Simple CRDT demo
│   ├── debug-crdt.js                 # CRDT tree visualization
│   └── README.md                     # Examples docs
└── run-all-tests.js         # Main test runner
```

## Running Tests

### Run All Tests (Recommended)

```bash
npm test
```

This runs all unit tests and end-to-end tests with a comprehensive summary.

### Run Specific Test Suites

```bash
# All unit tests
npm run test:unit

# Individual unit tests
npm run test:unit:crdt        # CRDT data structure only
npm run test:unit:document    # DocumentService only
npm run test:unit:storage     # SQLiteStorage only

# End-to-end tests
npm run test:e2e
```

### Run Individual Test Files

```bash
node test/unit/crdt.test.js
node test/unit/document-service.test.js
node test/unit/sqlite-storage.test.js
node test/e2e/server-client.test.js
```

## Test Statistics

- **Total Test Suites**: 4 (3 unit, 1 e2e)
- **Total Tests**: 47
- **Total Assertions**: 141
- **Execution Time**: ~10 seconds
- **Success Rate**: 100% ✅

## What's Tested

### Unit Tests (125 assertions)

**CRDT (21 tests, 55 assertions)**
- Constructor initialization
- Insert operations (basic, sequential, duplicate handling)
- Delete operations (basic, nonexistent ID handling)
- getText() functionality
- getVisibleChars() (ordering, deletion filtering)
- Offset/ID mapping (bidirectional conversion)
- Edge cases and error handling

**DocumentService (13 tests, 28 assertions)**
- Document loading and caching
- Operation application (insert/delete)
- Multiple document isolation
- Persistence across service instances
- Storage integration

**SQLiteStorage (13 tests, 42 assertions)**
- Database initialization
- Table schema validation
- Operation persistence (insert/delete)
- Data retrieval and filtering
- Multi-document support

### End-to-End Tests (16 assertions)

**Server-Client Integration (12 tests)**
- Server startup and WebSocket connections
- Client initialization
- Single and multi-client operations
- Real-time broadcasting
- Concurrent editing convergence
- Insert in middle functionality
- Document persistence
- Document isolation

## Manual Tests

Located in `test/manual/`:

**backspace-delete-test.html**
- Interactive test for Backspace vs Delete keys
- Open directly in browser (no server needed)
- Verifies correct keyboard behavior

**manual-test.html**
- Server-client integration tests with UI
- Requires server running (`npm start`)
- Button-driven test scenarios

See `test/manual/README.md` for details.

## Example Scripts

Located in `test/examples/`:

These are NOT part of the main test suite, but useful for:
- Learning how the system works
- Debugging specific issues
- Prototyping new features

See `test/examples/README.md` for details.

## Test Output

When you run `npm test`, you'll see:

```
============================================================
     COLLABORATIVE DOCUMENT EDITOR - TEST SUITE
============================================================
Total Test Suites: 4
Unit Tests: 3
E2E Tests: 1

Running: CRDT Unit Tests
✅ PASSED - 55 assertions (0.04s)

Running: DocumentService Unit Tests
✅ PASSED - 28 assertions (0.04s)

Running: SQLiteStorage Unit Tests
✅ PASSED - 42 assertions (0.06s)

Running: Server-Client E2E Tests
✅ PASSED - 16 assertions (9.85s)

============================================================
                    TEST SUMMARY
============================================================
Total Suites: 4
✅ Passed: 4
❌ Failed: 0
Duration: 10.04s
============================================================

All tests passed! 🎉
```

## Troubleshooting

### Tests failing?

```bash
# Clean up test databases
rm -f test/test-storage.db test/e2e-test.db

# Run tests again
npm test
```

### Port already in use?

```bash
# Kill any running servers
pkill -f "node server/server.js"

# Run tests again
npm test
```

### Want more details?

Run individual test files to see detailed output:

```bash
node test/unit/crdt.test.js
```

---

For more information, see the main [README.md](../README.md).

# Test Examples

This directory contains example test scripts and debugging tools. These are **not** part of the main test suite (run with `npm test`), but are useful for manual testing and debugging.

## Example Test Scripts

### `concurrent-test.js`
Original concurrent editing test - now superseded by `test/e2e/server-client.test.js`.
Kept as an example of how to create WebSocket client tests.

**Run:**
```bash
# Start server first
npm start

# In another terminal
node test/examples/concurrent-test.js
```

### `middle-insert-test.js`
Tests inserting text in the middle of a document.
Useful for debugging offset calculation issues.

**Run:**
```bash
npm start  # Start server first
node test/examples/middle-insert-test.js
```

### `replace-test.js`
Tests text replacement (delete selection + insert).
Useful for debugging selection handling.

**Run:**
```bash
npm start  # Start server first
node test/examples/replace-test.js
```

### `simple-test.js`
Simple CRDT operation test - demonstrates basic insert operations.
Useful for understanding CRDT behavior.

**Run:**
```bash
node test/examples/simple-test.js
```

### `debug-crdt.js`
Debug tool for visualizing CRDT tree structure.
Shows how characters are organized in the tree.

**Run:**
```bash
node test/examples/debug-crdt.js
```

### `backspace-delete-doc.js`
Documentation script explaining Backspace vs Delete key behavior.
Outputs expected behavior, implementation details, and testing instructions.

**Run:**
```bash
node test/examples/backspace-delete-doc.js
```

## Usage

These scripts are for:
- **Learning** how the system works
- **Debugging** specific issues
- **Prototyping** new features
- **Manual testing** of specific scenarios

## Main Test Suite

For running the official test suite, use:
```bash
npm test
```

This runs all unit tests and end-to-end tests in:
- `test/unit/` - Unit tests
- `test/e2e/` - End-to-end integration tests

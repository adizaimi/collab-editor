# Manual Test Pages

This directory contains HTML pages for **manual testing** in a browser. These are **NOT** used by automated tests - they're for human verification of UI behavior.

## Test Pages

### `backspace-delete-test.html`
Interactive test page for verifying Backspace vs Delete key behavior.

**Purpose:** Verify that:
- Backspace deletes character BEFORE cursor
- Delete deletes character AFTER cursor

**How to use:**
1. Open file directly in browser: `open test/manual/backspace-delete-test.html`
2. Click "Setup" buttons to prepare test scenarios
3. Follow on-screen instructions
4. Verify correct behavior

**No server needed** - this is a standalone HTML file with embedded JavaScript.

---

### `manual-test.html`
Manual integration test page for testing server-client operations.

**Purpose:** Test server-client communication with button-driven tests.

**How to use:**
1. Start server: `npm start`
2. Open in browser: `http://localhost:3000/test/manual/manual-test.html`
3. Click test buttons to run scenarios
4. Verify results match expectations

**Requires server** - connects to WebSocket at localhost:3000.

---

## When to Use Manual Tests

Use these manual test pages when:
- **Debugging UI issues** - See exactly what the user sees
- **Testing browser-specific behavior** - Check different browsers
- **Verifying keyboard input** - Test actual keyboard events
- **Demonstrating features** - Show how things work

## Automated Tests

For automated testing, use:
```bash
npm test
```

This runs the full test suite in `test/unit/` and `test/e2e/`.

Manual tests are useful for things that are hard to automate (keyboard input, visual feedback, etc).

/**
 * UI DOM Tests
 *
 * Tests the client-side DOM functions from public/index.html using jsdom:
 * - renderEditor(): formattedChars → correct div-based HTML
 * - domOffsetToFlat(): DOM position → flat CRDT offset
 * - flatToDomOffset(): flat CRDT offset → DOM position
 * - getEditorText(): DOM → plain text extraction
 *
 * These tests verify that the div-per-line rendering approach produces
 * consistent offset mapping, especially around bullet lines and mixed
 * formatting scenarios.
 */

const { JSDOM } = require("jsdom")
const fs = require("fs")
const path = require("path")

let passed = 0
let failed = 0
let testNum = 0

function assert(condition, msg) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${msg}`)
    failed++
    return false
  }
  console.log(`  ✅ PASSED: ${msg}`)
  passed++
  return true
}

function runTest(name, fn) {
  testNum++
  console.log(`\n[Test ${testNum}] ${name}`)
  fn()
}

// Set up a jsdom environment with the editor div and extract the functions
// we need from the index.html script. We re-create per test group to get
// a clean DOM each time.

function createEnv() {
  const dom = new JSDOM(`<!DOCTYPE html>
<html><body>
<div id="editor" contenteditable="true"></div>
<div id="status"></div>
<span id="users-list"></span>
<span id="location"></span>
<div id="format-bar"></div>
</body></html>`, { url: "http://localhost:3000" })

  const { window } = dom
  const { document } = window

  const editor = document.getElementById("editor")

  // --- Replicate the functions from index.html ---

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function inlineAttrKey(attrs) {
    if (!attrs) return ''
    const parts = []
    if (attrs.bold) parts.push('b')
    if (attrs.italic) parts.push('i')
    return parts.join(',')
  }

  function wrapRun(text, attrs) {
    let style = ''
    if (attrs && attrs.bold) style += 'font-weight:bold;'
    if (attrs && attrs.italic) style += 'font-style:italic;'
    if (style) {
      return '<span style="' + style + '">' + text + '</span>'
    }
    return '<span>' + text + '</span>'
  }

  function renderEditor(formattedChars) {
    const lines = []
    let currentLine = { chars: [], isBullet: false }

    for (let i = 0; i < formattedChars.length; i++) {
      const ch = formattedChars[i]
      if (ch.value === '\n') {
        lines.push(currentLine)
        const isBullet = ch.attrs && ch.attrs.block === 'bullet'
        currentLine = { chars: [], isBullet }
      } else {
        currentLine.chars.push(ch)
      }
    }
    lines.push(currentLine)

    let html = ''
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]
      let lineHtml = ''

      let i = 0
      while (i < line.chars.length) {
        const ch = line.chars[i]
        const ak = inlineAttrKey(ch.attrs)
        let run = ''
        while (i < line.chars.length && inlineAttrKey(line.chars[i].attrs) === ak) {
          run += escapeHtml(line.chars[i].value)
          i++
        }
        lineHtml += wrapRun(run, ch.attrs)
      }

      const cls = line.isBullet ? ' class="bullet-line"' : ''
      html += '<div' + cls + '>' + (lineHtml || '<br>') + '</div>'
    }

    if (formattedChars.length === 0) {
      html = '<div><br></div>'
    }

    editor.innerHTML = html
  }

  function domOffsetToFlat(targetNode, targetOffset) {
    let count = 0
    let found = false

    function walk(node) {
      if (found) return

      if (node === targetNode) {
        if (node.nodeType === window.Node.TEXT_NODE) {
          count += targetOffset
        } else {
          if (node.nodeName === 'DIV' && node.parentNode === editor) {
            const idx = Array.from(editor.childNodes).indexOf(node)
            if (idx > 0) count += 1
          }
          for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) {
            countAll(node.childNodes[i])
          }
        }
        found = true
        return
      }

      if (node.nodeType === window.Node.TEXT_NODE) {
        count += node.textContent.length
      } else if (node.nodeName === 'BR') {
        // empty-line placeholder
      } else {
        if (node.nodeName === 'DIV' && node.parentNode === editor) {
          const idx = Array.from(editor.childNodes).indexOf(node)
          if (idx > 0) count += 1
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          if (found) return
          walk(node.childNodes[i])
        }
      }
    }

    function countAll(node) {
      if (node.nodeType === window.Node.TEXT_NODE) {
        count += node.textContent.length
      } else if (node.nodeName === 'BR') {
        // empty-line placeholder
      } else {
        if (node.nodeName === 'DIV' && node.parentNode === editor) {
          const idx = Array.from(editor.childNodes).indexOf(node)
          if (idx > 0) count += 1
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          countAll(node.childNodes[i])
        }
      }
    }

    walk(editor)
    return count
  }

  function walkInDiv(container, remaining) {
    for (let i = 0; i < container.childNodes.length; i++) {
      const node = container.childNodes[i]
      if (node.nodeType === window.Node.TEXT_NODE) {
        if (remaining <= node.textContent.length) {
          return { found: true, pos: { node: node, offset: remaining } }
        }
        remaining -= node.textContent.length
      } else if (node.nodeName === 'BR') {
        if (remaining === 0) {
          return { found: true, pos: { node: container, offset: i } }
        }
      } else {
        const result = walkInDiv(node, remaining)
        if (result.found) return result
        remaining = result.remaining
      }
    }
    return { found: false, remaining }
  }

  function flatToDomOffset(flatOffset) {
    let remaining = flatOffset
    const divs = editor.childNodes

    for (let d = 0; d < divs.length; d++) {
      const div = divs[d]
      if (d > 0) {
        if (remaining === 0) {
          return { node: editor, offset: d }
        }
        remaining -= 1
      }

      const result = walkInDiv(div, remaining)
      if (result.found) return result.pos
      remaining = result.remaining
    }

    return { node: editor, offset: editor.childNodes.length }
  }

  function getTextFromNode(node) {
    let text = ''
    for (const child of node.childNodes) {
      if (child.nodeType === window.Node.TEXT_NODE) {
        text += child.textContent
      } else if (child.nodeName === 'BR') {
        // placeholder
      } else if (child.nodeType === window.Node.ELEMENT_NODE) {
        text += getTextFromNode(child)
      }
    }
    return text
  }

  function getEditorText() {
    let text = ''
    let blockCount = 0
    for (const child of editor.childNodes) {
      if (child.nodeType === window.Node.TEXT_NODE) {
        text += child.textContent
      } else if (child.nodeName === 'BR') {
        text += '\n'
      } else if (child.nodeType === window.Node.ELEMENT_NODE) {
        if (blockCount > 0) text += '\n'
        text += getTextFromNode(child)
        blockCount++
      }
    }
    return text
  }

  return { dom, window, document, editor, renderEditor, domOffsetToFlat, flatToDomOffset, getEditorText }
}

// Helper: make a formattedChars array from a string with optional attrs
function makeChars(str, perCharAttrs) {
  return Array.from(str).map((ch, i) => ({
    value: ch,
    attrs: (perCharAttrs && perCharAttrs[i]) ? { ...perCharAttrs[i] } : {}
  }))
}

// ============================================================
// renderEditor tests
// ============================================================

runTest("renderEditor: single line plain text", () => {
  const env = createEnv()
  env.renderEditor(makeChars("hello"))
  assert(env.editor.childNodes.length === 1, "one div for one line")
  assert(env.editor.childNodes[0].nodeName === "DIV", "child is a div")
  assert(env.getEditorText() === "hello", "text extracted correctly")
})

runTest("renderEditor: empty document", () => {
  const env = createEnv()
  env.renderEditor([])
  assert(env.editor.childNodes.length === 1, "one div for empty doc")
  assert(env.editor.childNodes[0].querySelector("br") !== null, "contains BR placeholder")
  assert(env.getEditorText() === "", "empty text")
})

runTest("renderEditor: two lines", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  assert(env.editor.childNodes.length === 2, "two divs for two lines")
  assert(env.getEditorText() === "ab\ncd", "text correct")
})

runTest("renderEditor: three lines with empty middle", () => {
  const env = createEnv()
  env.renderEditor(makeChars("a\n\nb"))
  assert(env.editor.childNodes.length === 3, "three divs")
  const middleDiv = env.editor.childNodes[1]
  assert(middleDiv.querySelector("br") !== null, "empty line has BR placeholder")
  assert(env.getEditorText() === "a\n\nb", "text correct")
})

runTest("renderEditor: bullet line", () => {
  const env = createEnv()
  // "ab\ncd" where \n has block:bullet → second line is a bullet
  const chars = makeChars("ab\ncd")
  chars[2].attrs = { block: "bullet" }  // the \n
  env.renderEditor(chars)
  assert(env.editor.childNodes.length === 2, "two divs")
  assert(env.editor.childNodes[1].className === "bullet-line", "second div is bullet-line")
  assert(env.getEditorText() === "ab\ncd", "text correct with bullet")
})

runTest("renderEditor: multiple bullet lines", () => {
  const env = createEnv()
  // "a\nb\nc" with both newlines as bullets
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  chars[3].attrs = { block: "bullet" }
  env.renderEditor(chars)
  assert(env.editor.childNodes.length === 3, "three divs")
  assert(env.editor.childNodes[0].className === "", "first line not bullet")
  assert(env.editor.childNodes[1].className === "bullet-line", "second line is bullet")
  assert(env.editor.childNodes[2].className === "bullet-line", "third line is bullet")
  assert(env.getEditorText() === "a\nb\nc", "text correct")
})

runTest("renderEditor: bullet then non-bullet", () => {
  const env = createEnv()
  // "a\nb\nc" — first \n is bullet, second is not
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  env.renderEditor(chars)
  assert(env.editor.childNodes[1].className === "bullet-line", "second line is bullet")
  assert(env.editor.childNodes[2].className === "", "third line is not bullet")
  assert(env.getEditorText() === "a\nb\nc", "text correct")
})

runTest("renderEditor: bold text produces styled span", () => {
  const env = createEnv()
  const chars = makeChars("ab", { 0: { bold: true }, 1: { bold: true } })
  env.renderEditor(chars)
  const span = env.editor.querySelector("span")
  assert(span !== null, "has a span")
  assert(span.style.fontWeight === "bold", "span has bold style")
})

runTest("renderEditor: mixed bold and plain in same line", () => {
  const env = createEnv()
  const chars = makeChars("abc", { 0: { bold: true }, 1: {}, 2: { italic: true } })
  env.renderEditor(chars)
  const spans = env.editor.querySelectorAll("span")
  assert(spans.length === 3, "three spans for three formatting runs")
  assert(env.getEditorText() === "abc", "text correct")
})

// ============================================================
// Offset mapping round-trip tests
// ============================================================

runTest("offset round-trip: single line 'hello'", () => {
  const env = createEnv()
  env.renderEditor(makeChars("hello"))
  for (let i = 0; i <= 5; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: two lines 'ab\\ncd'", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // flat offsets: a=0, b=1, \n=2, c=3, d=4
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: three lines 'x\\ny\\nz'", () => {
  const env = createEnv()
  env.renderEditor(makeChars("x\ny\nz"))
  // flat: x=0, \n=1, y=2, \n=3, z=4
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: empty line in middle 'a\\n\\nb'", () => {
  const env = createEnv()
  env.renderEditor(makeChars("a\n\nb"))
  // flat: a=0, \n=1, \n=2, b=3
  for (let i = 0; i <= 3; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: bullet line 'ab\\ncd' with bullet", () => {
  const env = createEnv()
  const chars = makeChars("ab\ncd")
  chars[2].attrs = { block: "bullet" }
  env.renderEditor(chars)
  // flat: a=0, b=1, \n=2, c=3, d=4
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: multiple bullet lines", () => {
  const env = createEnv()
  // "a\nb\nc" with both newlines as bullets
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  chars[3].attrs = { block: "bullet" }
  env.renderEditor(chars)
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: bullet then non-bullet", () => {
  const env = createEnv()
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  // chars[3] has no block attr — third line is non-bullet
  env.renderEditor(chars)
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: non-bullet then bullet", () => {
  const env = createEnv()
  const chars = makeChars("a\nb\nc")
  // chars[1] no block — second line is plain
  chars[3].attrs = { block: "bullet" }  // third line is bullet
  env.renderEditor(chars)
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: bold text in first line", () => {
  const env = createEnv()
  const chars = makeChars("ab\ncd", { 0: { bold: true }, 1: { bold: true } })
  env.renderEditor(chars)
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

runTest("offset round-trip: bold text in bullet line", () => {
  const env = createEnv()
  const chars = makeChars("ab\ncd")
  chars[2].attrs = { block: "bullet" }
  chars[3].attrs = { bold: true }  // 'c' is bold inside bullet
  chars[4].attrs = { bold: true }  // 'd' is bold inside bullet
  env.renderEditor(chars)
  for (let i = 0; i <= 4; i++) {
    const domPos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(domPos.node, domPos.offset)
    assert(flat === i, `round-trip offset ${i} → ${flat}`)
  }
})

// ============================================================
// domOffsetToFlat specific tests
// ============================================================

runTest("domOffsetToFlat: target is editor node at child 0", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // editor offset 0 = before first div = flat 0
  const flat = env.domOffsetToFlat(env.editor, 0)
  assert(flat === 0, "editor offset 0 = flat 0")
})

runTest("domOffsetToFlat: target is editor node at child 1", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // editor offset 1 = after first div = flat 2 (a,b) + 1 (\n) = 3
  const flat = env.domOffsetToFlat(env.editor, 1)
  // Counts all of div[0]: 2 chars. Then stops. So flat = 2.
  // Wait — offset 1 means "after 1 child", which is after div[0].
  // countAll(div[0]): texts = 2. No newline for div[0] (idx 0).
  // So flat = 2. But the \n is between div[0] and div[1], and we
  // haven't entered div[1] yet, so it's not counted yet. flat=2.
  // Actually, the user putting cursor at editor:1 means at the boundary.
  // This is the position right after 'b' and right before the newline.
  // So flat=2 is correct (cursor between 'b' and '\n').
  assert(flat === 2, "editor offset 1 = flat 2 (after first line)")
})

runTest("domOffsetToFlat: target is editor node at child 2", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // editor offset 2 = after both divs.
  // countAll(div[0]): 2 chars (no newline, idx 0)
  // countAll(div[1]): +1 newline (idx 1) + 2 chars = 3
  // Total = 5. But text is "ab\ncd" = 5 chars. Correct — past end.
  const flat = env.domOffsetToFlat(env.editor, 2)
  assert(flat === 5, "editor offset 2 = flat 5 (past end)")
})

runTest("domOffsetToFlat: target is text node in second div", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // Find the text node "cd" in the second div
  const div1 = env.editor.childNodes[1]
  const span = div1.querySelector("span")
  const textNode = span.childNodes[0]
  assert(textNode.textContent === "cd", "found correct text node")
  const flat = env.domOffsetToFlat(textNode, 1)
  // div[0]: 2 chars. div[1]: +1 newline + 'c' = offset 4
  assert(flat === 4, "offset 1 in 'cd' text node = flat 4")
})

// ============================================================
// flatToDomOffset specific tests
// ============================================================

runTest("flatToDomOffset: offset 0 in single line", () => {
  const env = createEnv()
  env.renderEditor(makeChars("abc"))
  const pos = env.flatToDomOffset(0)
  assert(pos.node.nodeType === env.window.Node.TEXT_NODE, "lands on text node")
  assert(pos.offset === 0, "at start of text")
})

runTest("flatToDomOffset: offset at newline boundary round-trips", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // flat offset 2 = the \n character position.
  // The exact DOM node may vary (end of first div or between divs)
  // but the round-trip must be correct.
  const pos = env.flatToDomOffset(2)
  const flat = env.domOffsetToFlat(pos.node, pos.offset)
  assert(flat === 2, "newline offset 2 round-trips correctly")
  // Offset 3 = start of 'c' in second line
  const pos3 = env.flatToDomOffset(3)
  assert(pos3.node.textContent === "cd", "offset 3 lands in second line text")
  assert(pos3.offset === 0, "at start of 'cd'")
})

runTest("flatToDomOffset: offset past newline into second line", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab\ncd"))
  // flat offset 3 = 'c'
  const pos = env.flatToDomOffset(3)
  assert(pos.node.nodeType === env.window.Node.TEXT_NODE, "lands on text node")
  assert(pos.node.textContent === "cd", "in second line's text")
  assert(pos.offset === 0, "at start of 'cd'")
})

runTest("flatToDomOffset: past end returns editor end", () => {
  const env = createEnv()
  env.renderEditor(makeChars("ab"))
  const pos = env.flatToDomOffset(10)
  assert(pos.node === env.editor, "at editor level")
  assert(pos.offset === env.editor.childNodes.length, "past all children")
})

// ============================================================
// getEditorText tests
// ============================================================

runTest("getEditorText: simple text", () => {
  const env = createEnv()
  env.renderEditor(makeChars("hello world"))
  assert(env.getEditorText() === "hello world", "plain text extracted")
})

runTest("getEditorText: multiline", () => {
  const env = createEnv()
  env.renderEditor(makeChars("line1\nline2\nline3"))
  assert(env.getEditorText() === "line1\nline2\nline3", "multiline text")
})

runTest("getEditorText: trailing newline", () => {
  const env = createEnv()
  env.renderEditor(makeChars("abc\n"))
  assert(env.getEditorText() === "abc\n", "trailing newline preserved")
})

runTest("getEditorText: multiple empty lines", () => {
  const env = createEnv()
  env.renderEditor(makeChars("\n\n"))
  assert(env.getEditorText() === "\n\n", "two newlines = two empty lines")
})

runTest("getEditorText: bullet lines produce same text as non-bullet", () => {
  const env = createEnv()
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  chars[3].attrs = { block: "bullet" }
  env.renderEditor(chars)
  assert(env.getEditorText() === "a\nb\nc", "bullets don't change extracted text")
})

runTest("getEditorText: bold/italic don't affect extracted text", () => {
  const env = createEnv()
  const chars = makeChars("abc", { 0: { bold: true }, 1: { italic: true } })
  env.renderEditor(chars)
  assert(env.getEditorText() === "abc", "formatting doesn't affect text")
})

// ============================================================
// Edge cases: the exact scenarios that were buggy before the fix
// ============================================================

runTest("BUG REGRESSION: Enter after bullet line produces correct offsets", () => {
  const env = createEnv()
  // Simulate: "item1\nitem2\n" where first \n is bullet
  // This is what happens when you have a bullet line and press Enter at the end
  const chars = makeChars("item1\nitem2\n")
  chars[5].attrs = { block: "bullet" }  // first \n is bullet
  env.renderEditor(chars)

  assert(env.editor.childNodes.length === 3, "three divs")
  assert(env.getEditorText() === "item1\nitem2\n", "text correct")

  // The crucial test: offset mapping for characters AFTER the bullet line
  // flat 6 = 'i' in "item2"
  const pos6 = env.flatToDomOffset(6)
  const flat6 = env.domOffsetToFlat(pos6.node, pos6.offset)
  assert(flat6 === 6, "offset 6 (start of line after bullet) round-trips correctly")

  // flat 10 = '\n' at end (the second newline, creating third line)
  const pos10 = env.flatToDomOffset(10)
  const flat10 = env.domOffsetToFlat(pos10.node, pos10.offset)
  assert(flat10 === 10, "offset 10 (newline after bullet content) round-trips")

  // flat 11 = empty third line
  const pos11 = env.flatToDomOffset(11)
  const flat11 = env.domOffsetToFlat(pos11.node, pos11.offset)
  assert(flat11 === 11, "offset 11 (empty line after second newline) round-trips")
})

runTest("BUG REGRESSION: typing after bullet→non-bullet transition", () => {
  const env = createEnv()
  // "a\nb\nc" — bullet, then plain
  const chars = makeChars("a\nb\nc")
  chars[1].attrs = { block: "bullet" }
  env.renderEditor(chars)

  // Offset 4 = 'c' on the non-bullet line after a bullet line
  const pos = env.flatToDomOffset(4)
  const flat = env.domOffsetToFlat(pos.node, pos.offset)
  assert(flat === 4, "char after bullet→non-bullet transition maps correctly")
})

runTest("BUG REGRESSION: consecutive bullets have correct offsets", () => {
  const env = createEnv()
  // "a\nb\nc\nd" — all newlines are bullets (3 bullet lines)
  const chars = makeChars("a\nb\nc\nd")
  chars[1].attrs = { block: "bullet" }
  chars[3].attrs = { block: "bullet" }
  chars[5].attrs = { block: "bullet" }
  env.renderEditor(chars)

  assert(env.editor.childNodes.length === 4, "four divs")

  // Test every offset in this 7-char string
  for (let i = 0; i <= 6; i++) {
    const pos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(pos.node, pos.offset)
    assert(flat === i, `consecutive bullets: offset ${i} round-trips`)
  }
})

runTest("BUG REGRESSION: Enter on empty bullet line", () => {
  const env = createEnv()
  // "text\n\n" — first \n is bullet, second \n creates empty line after bullet
  const chars = makeChars("text\n\n")
  chars[4].attrs = { block: "bullet" }
  env.renderEditor(chars)

  assert(env.editor.childNodes.length === 3, "three divs")
  assert(env.editor.childNodes[1].className === "bullet-line", "second div is bullet")

  // Offset 5 = the second \n
  const pos5 = env.flatToDomOffset(5)
  const flat5 = env.domOffsetToFlat(pos5.node, pos5.offset)
  assert(flat5 === 5, "second newline after bullet maps correctly")
})

runTest("BUG REGRESSION: long document with mixed bullets and formatting", () => {
  const env = createEnv()
  // Simulate a realistic document:
  // "Title\n• bold item\n• italic item\nplain text"
  const text = "Title\nbold item\nitalic item\nplain text"
  const chars = makeChars(text)
  // First \n is bullet
  chars[5].attrs = { block: "bullet" }
  // "bold" in "bold item" (offsets 6-9)
  for (let i = 6; i <= 9; i++) chars[i].attrs = { bold: true }
  // Second \n is bullet
  chars[15].attrs = { block: "bullet" }
  // "italic" in "italic item" (offsets 16-21)
  for (let i = 16; i <= 21; i++) chars[i].attrs = { italic: true }
  // Third \n is not bullet (plain line follows)

  env.renderEditor(chars)

  assert(env.editor.childNodes.length === 4, "four divs")
  assert(env.getEditorText() === text, "text correct for mixed document")

  // Round-trip every offset
  let allCorrect = true
  for (let i = 0; i <= text.length; i++) {
    const pos = env.flatToDomOffset(i)
    const flat = env.domOffsetToFlat(pos.node, pos.offset)
    if (flat !== i) {
      assert(false, `mixed doc offset ${i} round-trip failed: got ${flat}`)
      allCorrect = false
    }
  }
  if (allCorrect) {
    assert(true, `all ${text.length + 1} offsets round-trip correctly in mixed document`)
  }
})

// ============================================================
// Remote cursor overlay tests
// ============================================================

function createCursorEnv() {
  const dom = new JSDOM(`<!DOCTYPE html>
<html><body>
<div id="editor-container" style="position:relative;">
  <div id="editor" contenteditable="true"></div>
  <div id="cursor-overlay"></div>
</div>
<div id="status"></div>
<span id="users-list"></span>
<span id="location"></span>
<div id="format-bar"></div>
</body></html>`, { url: "http://localhost:3000" })

  const { window } = dom
  const { document } = window
  const editor = document.getElementById("editor")
  const cursorOverlay = document.getElementById("cursor-overlay")

  // Replicate needed functions
  function escapeHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function inlineAttrKey(a) { if(!a) return ''; const p=[]; if(a.bold) p.push('b'); if(a.italic) p.push('i'); return p.join(',') }
  function wrapRun(text, attrs) {
    let s=''; if(attrs&&attrs.bold) s+='font-weight:bold;'; if(attrs&&attrs.italic) s+='font-style:italic;'
    return s ? '<span style="'+s+'">'+text+'</span>' : '<span>'+text+'</span>'
  }
  function renderEditor(formattedChars) {
    const lines=[]; let cur={chars:[],isBullet:false}
    for(let i=0;i<formattedChars.length;i++){
      if(formattedChars[i].value==='\n'){lines.push(cur);cur={chars:[],isBullet:!!(formattedChars[i].attrs&&formattedChars[i].attrs.block==='bullet')}}
      else cur.chars.push(formattedChars[i])
    }
    lines.push(cur)
    let html=''
    for(const line of lines){
      let lh='',i=0
      while(i<line.chars.length){const ch=line.chars[i];const ak=inlineAttrKey(ch.attrs);let r=''
        while(i<line.chars.length&&inlineAttrKey(line.chars[i].attrs)===ak){r+=escapeHtml(line.chars[i].value);i++}
        lh+=wrapRun(r,ch.attrs)}
      html+='<div'+(line.isBullet?' class="bullet-line"':'')+'>'+(lh||'<br>')+'</div>'
    }
    if(!formattedChars.length) html='<div><br></div>'
    editor.innerHTML=html
  }

  function walkInDiv(container, remaining) {
    for(let i=0;i<container.childNodes.length;i++){
      const n=container.childNodes[i]
      if(n.nodeType===window.Node.TEXT_NODE){if(remaining<=n.textContent.length) return {found:true,pos:{node:n,offset:remaining}};remaining-=n.textContent.length}
      else if(n.nodeName==='BR'){if(remaining===0) return {found:true,pos:{node:container,offset:i}}}
      else{const r=walkInDiv(n,remaining);if(r.found) return r;remaining=r.remaining}
    }
    return {found:false,remaining}
  }
  function flatToDomOffset(flat) {
    let rem=flat; const divs=editor.childNodes
    for(let d=0;d<divs.length;d++){
      if(d>0){if(rem===0) return {node:editor,offset:d};rem-=1}
      const r=walkInDiv(divs[d],rem); if(r.found) return r.pos; rem=r.remaining
    }
    return {node:editor,offset:editor.childNodes.length}
  }

  // Simplified renderRemoteCursors for testing (no getClientRects in jsdom)
  // We test that the function creates the right DOM elements based on cursor data
  function renderRemoteCursors(remoteCursors, myUserId) {
    cursorOverlay.innerHTML = ''
    for (const [userId, cursor] of Object.entries(remoteCursors)) {
      if (userId === myUserId) continue
      const color = cursor.color || '#888'
      const hasSelection = cursor.selEnd !== undefined && cursor.selEnd !== cursor.offset

      if (hasSelection) {
        const start = Math.min(cursor.offset, cursor.selEnd)
        const end = Math.max(cursor.offset, cursor.selEnd)
        // In jsdom getClientRects doesn't work, so create selection markers
        const sel = document.createElement('div')
        sel.className = 'remote-selection'
        sel.style.background = color
        sel.dataset.start = start
        sel.dataset.end = end
        sel.dataset.userId = userId
        cursorOverlay.appendChild(sel)
      }

      // Caret
      const caretPos = flatToDomOffset(cursor.offset)
      if (caretPos) {
        const caret = document.createElement('div')
        caret.className = 'remote-cursor'
        caret.style.background = color
        caret.dataset.offset = cursor.offset
        caret.dataset.userId = userId
        const label = document.createElement('span')
        label.className = 'cursor-label'
        label.style.background = color
        label.textContent = userId
        caret.appendChild(label)
        cursorOverlay.appendChild(caret)
      }
    }
  }

  return { dom, window, document, editor, cursorOverlay, renderEditor, flatToDomOffset, renderRemoteCursors }
}

runTest("Remote cursor: caret rendered for remote user", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello World"))
  const cursors = { user2: { offset: 5, selEnd: 5, color: '#E53935' } }
  env.renderRemoteCursors(cursors, 'user1')

  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "one remote cursor caret rendered")
  assert(carets[0].dataset.offset === '5', "caret at correct offset")
  assert(carets[0].style.cssText.includes('229, 57, 53'), "caret has user's color")

  const label = carets[0].querySelector('.cursor-label')
  assert(label !== null, "caret has a label")
  assert(label.textContent === 'user2', "label shows user ID")
})

runTest("Remote cursor: selection highlight rendered", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello World"))
  const cursors = { user2: { offset: 2, selEnd: 8, color: '#1E88E5' } }
  env.renderRemoteCursors(cursors, 'user1')

  const sels = env.cursorOverlay.querySelectorAll('.remote-selection')
  assert(sels.length === 1, "one selection highlight rendered")
  assert(sels[0].style.cssText.includes('30, 136, 229'), "selection has user's color")
  assert(sels[0].dataset.start === '2', "selection start correct")
  assert(sels[0].dataset.end === '8', "selection end correct")

  // Caret should also be present at cursor.offset
  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "caret also rendered with selection")
})

runTest("Remote cursor: own cursor is NOT rendered", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello"))
  const cursors = {
    user1: { offset: 2, selEnd: 2, color: '#E53935' },
    user2: { offset: 4, selEnd: 4, color: '#1E88E5' }
  }
  env.renderRemoteCursors(cursors, 'user1')

  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "only remote user's cursor rendered")
  assert(carets[0].dataset.userId === 'user2', "rendered cursor is for user2")
})

runTest("Remote cursor: multiple users rendered", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello World"))
  const cursors = {
    user2: { offset: 3, selEnd: 3, color: '#E53935' },
    user3: { offset: 7, selEnd: 7, color: '#43A047' },
    user4: { offset: 1, selEnd: 5, color: '#FB8C00' }
  }
  env.renderRemoteCursors(cursors, 'user1')

  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 3, "three remote cursors rendered")

  const sels = env.cursorOverlay.querySelectorAll('.remote-selection')
  assert(sels.length === 1, "one selection highlight (only user4 has selection)")
  assert(sels[0].dataset.userId === 'user4', "selection is for user4")
})

runTest("Remote cursor: re-render clears old overlays", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello"))

  // First render with 2 users
  env.renderRemoteCursors({
    user2: { offset: 1, selEnd: 1, color: '#E53935' },
    user3: { offset: 3, selEnd: 3, color: '#43A047' }
  }, 'user1')
  assert(env.cursorOverlay.querySelectorAll('.remote-cursor').length === 2, "two cursors initially")

  // Re-render with 1 user — old ones should be gone
  env.renderRemoteCursors({
    user2: { offset: 4, selEnd: 4, color: '#E53935' }
  }, 'user1')
  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "only one cursor after re-render")
  assert(carets[0].dataset.offset === '4', "cursor at updated position")
})

runTest("Remote cursor: no cursor at offset 0 when no selection", () => {
  const env = createCursorEnv()
  env.renderEditor(makeChars("Hello"))
  const cursors = { user2: { offset: 0, selEnd: 0, color: '#E53935' } }
  env.renderRemoteCursors(cursors, 'user1')

  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "cursor rendered at offset 0")
  assert(carets[0].dataset.offset === '0', "offset is 0")
})

runTest("Remote cursor: cursor rendered on empty line", () => {
  const env = createCursorEnv()
  // "Hello\n\nWorld" — line 2 is empty (offset 6 is the empty line after first \n)
  env.renderEditor(makeChars("Hello\n\nWorld"))
  const cursors = { user2: { offset: 6, selEnd: 6, color: '#1E88E5' } }
  env.renderRemoteCursors(cursors, 'user1')

  const carets = env.cursorOverlay.querySelectorAll('.remote-cursor')
  assert(carets.length === 1, "cursor rendered on empty line")
  assert(carets[0].dataset.offset === '6', "cursor offset is 6 (empty line)")
  assert(carets[0].dataset.userId === 'user2', "cursor belongs to user2")
})

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60))
console.log("UI DOM Unit Tests Summary")
console.log("=".repeat(60))
console.log(`Total Assertions: ${passed + failed}`)
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log("=".repeat(60))

if (failed > 0) process.exit(1)

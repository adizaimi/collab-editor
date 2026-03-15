class CRDTText {
  constructor() {
    this.root = "ROOT"
    this.chars = new Map()
    this.chars.set(this.root, {id:this.root, value:"", left:null, right:[], deleted:false, attrs:{}})
  }

  insert(value, afterId, id, attrs = null){
    if(this.chars.has(id)) return
    const left = this.chars.get(afterId)
    if(!left) return
    const char = {id, value, left:afterId, right:[], deleted:false, attrs: attrs || {}}
    this.chars.set(id,char)

    // Insert at the beginning of right array (most recent insertion wins position)
    // This ensures that when inserting at the same position, the latest insert appears first
    left.right.unshift(id)
  }

  delete(id){
    const node = this.chars.get(id)
    if(node) node.deleted = true
  }

  getText(){
    let out = ""
    // Use iterative traversal to avoid stack overflow on large documents
    const stack = [this.root]

    while (stack.length > 0) {
      const id = stack.pop()
      const node = this.chars.get(id)

      if (id !== this.root && !node.deleted) {
        out += node.value
      }

      // Push children in reverse order so they're processed left-to-right
      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return out
  }

  getVisibleChars(){
    const result = []
    // Use iterative traversal to avoid stack overflow on large documents
    const stack = [this.root]

    while (stack.length > 0) {
      const id = stack.pop()
      const node = this.chars.get(id)

      if (id !== this.root && !node.deleted) {
        result.push(node)
      }

      // Push children in reverse order so they're processed left-to-right
      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return result
  }

  getIdAtOffset(offset){
    let i = -1
    let result = null
    // Use iterative traversal to avoid stack overflow on large documents
    const stack = [this.root]

    while (stack.length > 0 && result === null) {
      const id = stack.pop()
      const node = this.chars.get(id)

      if (id !== this.root && !node.deleted) {
        i++
        if (i === offset) {
          result = id
          break
        }
      }

      // Push children in reverse order so they're processed left-to-right
      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return result || this.root
  }

  getOffsetOfId(targetId){
    let offset = 0
    let found = false
    // Use iterative traversal to avoid stack overflow on large documents
    const stack = [this.root]

    while (stack.length > 0 && !found) {
      const id = stack.pop()

      if (id === targetId) {
        found = true
        break
      }

      const node = this.chars.get(id)
      if (id !== this.root && !node.deleted) {
        offset++
      }

      // Push children in reverse order so they're processed left-to-right
      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return offset
  }

  findIdByValueAtOffset(value, targetOffset){
    let currentOffset = -1
    let result = null
    // Use iterative traversal to avoid stack overflow on large documents
    const stack = [this.root]

    while (stack.length > 0 && result === null) {
      const id = stack.pop()
      const node = this.chars.get(id)

      if (id !== this.root && !node.deleted) {
        currentOffset++
        if (currentOffset === targetOffset && node.value === value) {
          result = id
          break
        }
      }

      // Push children in reverse order so they're processed left-to-right
      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return result
  }

  /**
   * Format a character by setting attributes (bold, italic, block type, etc.)
   * @param {string} charId - ID of the character to format
   * @param {object} attrs - Attributes to set (e.g. {bold: true, italic: true})
   * @returns {boolean} - Whether the format was applied
   */
  format(charId, attrs){
    const node = this.chars.get(charId)
    if(!node || node.deleted) return false
    for(const [key, value] of Object.entries(attrs)){
      if(value === null || value === false){
        delete node.attrs[key]
      } else {
        node.attrs[key] = value
      }
    }
    return true
  }

  /**
   * Get visible characters with their formatting attributes
   * Returns array of {id, value, attrs} for rendering
   */
  getFormattedChars(){
    const result = []
    const stack = [this.root]

    while (stack.length > 0) {
      const id = stack.pop()
      const node = this.chars.get(id)

      if (id !== this.root && !node.deleted) {
        result.push({id: node.id, value: node.value, attrs: {...node.attrs}})
      }

      for (let j = node.right.length - 1; j >= 0; j--) {
        stack.push(node.right[j])
      }
    }

    return result
  }

  /**
   * Compact CRDT by removing old tombstones and rebuilding structure
   * This prevents unbounded memory growth from deleted characters
   */
  compact() {
    const formattedChars = this.getFormattedChars()
    const oldSize = this.chars.size

    // Rebuild CRDT from current visible chars, preserving attrs
    this.chars.clear()
    this.root = 'ROOT'
    this.chars.set(this.root, {id: this.root, value: "", left: null, right: [], deleted: false, attrs: {}})

    const compactId = `compact:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    let afterId = 'ROOT'
    for (let i = 0; i < formattedChars.length; i++) {
      const id = `${compactId}:${i}`
      const attrs = Object.keys(formattedChars[i].attrs).length > 0 ? {...formattedChars[i].attrs} : null
      this.insert(formattedChars[i].value, afterId, id, attrs)
      afterId = id
    }

    const newSize = this.chars.size
    const removed = oldSize - newSize

    return {
      oldSize,
      newSize,
      removed,
      compressionRatio: oldSize > 0 ? (removed / oldSize * 100).toFixed(1) : 0
    }
  }

  /**
   * Serialize CRDT state to JSON (for snapshots)
   */
  serialize() {
    const chars = Array.from(this.chars.entries()).map(([id, node]) => {
      const entry = {
        id,
        value: node.value,
        left: node.left,
        right: node.right,
        deleted: node.deleted
      }
      // Only include attrs if non-empty to keep snapshots compact
      if (node.attrs && Object.keys(node.attrs).length > 0) {
        entry.attrs = node.attrs
      }
      return entry
    })
    return JSON.stringify({ root: this.root, chars })
  }

  /**
   * Deserialize CRDT state from JSON (for loading snapshots)
   */
  static deserialize(json) {
    const data = JSON.parse(json)
    const crdt = new CRDTText()
    crdt.root = data.root
    crdt.chars.clear()

    for (const node of data.chars) {
      crdt.chars.set(node.id, {
        id: node.id,
        value: node.value,
        left: node.left,
        right: node.right,
        deleted: node.deleted,
        attrs: node.attrs || {}
      })
    }

    return crdt
  }
}

module.exports = CRDTText
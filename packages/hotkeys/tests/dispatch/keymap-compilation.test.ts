import { expect, it, vi } from 'vitest'
import { createDispatcher } from '../../src/index.js'
import * as trie from '../../src/chords/trie.js'

it('builds exactly one trie for construction and each successful replacement', () => {
  const build = vi.spyOn(trie, 'buildKeymapTrie')
  try {
    using dispatcher = createDispatcher({ keymap: [{ keys: 'K C', command: 'old' }] })
    expect(build).toHaveBeenCalledTimes(1)
    dispatcher.setKeymap([{ keys: 'F1', command: 'new' }])
    expect(build).toHaveBeenCalledTimes(2)
    expect(() => dispatcher.setKeymap([{ keys: 'Mod+', command: 'bad' }])).toThrow()
    expect(build).toHaveBeenCalledTimes(2)
  } finally {
    build.mockRestore()
  }
})

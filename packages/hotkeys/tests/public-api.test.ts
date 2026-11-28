import coreSource from '../src/index.ts?raw'
import adapterSource from '../src/adapter/index.ts?raw'
import terminalSource from '../src/terminal/index.ts?raw'
import { expect, it } from 'vitest'
import * as hotkeys from '../src/index.js'
import * as adapter from '../src/adapter/index.js'
import * as terminal from '../src/terminal/index.js'

it.each([
  [
    'index',
    hotkeys,
    coreSource,
    [
      'HotkeyRecorder',
      'HotkeySequenceRecorder',
      'KeyStateTracker',
      'areHotkeysEqual',
      'compileKeymap',
      'createBrowserDispatcher',
      'createDispatcher',
      'createHotkeyRegistry',
      'createKeyContext',
      'createKeyInput',
      'detectPlatform',
      'explainKeymap',
      'findHotkeyConflicts',
      'formatForDisplay',
      'getHotkeyRegistry',
      'getKeyStateTracker',
      'isModifierKey',
      'keyInputFromKeyboardEvent',
      'matchesHeldModifiers',
      'matchesKeyInput',
      'matchesKeyboardEvent',
      'normalizeHotkey',
      'normalizeKeyName',
      'parseContextPredicate',
      'parseHotkey',
      'parseKeyContext',
      'parseShortcut',
      'registerHotkey',
    ],
  ],
  [
    'adapter/index',
    adapter,
    adapterSource,
    [
      'attachKeyListeners',
      'browserKeyEffects',
      'buildKeymapTrie',
      'createChordRuntime',
      'evaluatePredicate',
      'predicateDepth',
      'replayTextInput',
      'resolveKeymapNode',
      'trieStep',
    ],
  ],
  [
    'terminal/index',
    terminal,
    terminalSource,
    ['createTerminalDispatcher', 'keyInputFromTerminalKey', 'terminalKeyEffects'],
  ],
] as const)('curates the %s exports', (_path, exports, source, expected) => {
  expect(Object.keys(exports).sort()).toEqual(expected.toSorted())
  expect(source).not.toMatch(/export\s*\*/)
})

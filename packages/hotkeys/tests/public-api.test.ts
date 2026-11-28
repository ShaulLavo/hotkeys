import coreSource from '../src/index.ts?raw'
import adapterSource from '../src/adapter/index.ts?raw'
import reactSource from '../src/react/index.ts?raw'
import terminalSource from '../src/terminal/index.ts?raw'
import { expect, it } from 'vitest'
import * as hotkeys from '../src/index.js'
import * as adapter from '../src/adapter/index.js'
import * as react from '../src/react/index.js'
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
    'react/index',
    react,
    reactSource,
    [
      'createHotkeysContext',
      'HotkeysProvider',
      'FocusScope',
      'useFocusNode',
      'useHotkeysDispatcher',
      'usePendingChord',
      'useHotkey',
      'useHotkeySequence',
      'useHotkeys',
      'useHotkeyRegistrations',
      'useHeldKeys',
      'useHeldKeyCodes',
      'useKeyHold',
      'useHotkeyHint',
      'useHotkeyRecorder',
      'useHotkeySequenceRecorder',
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

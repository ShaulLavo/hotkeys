# Overview

Use hotkeys for three jobs: observe keyboard state, register shortcut callbacks, or route commands through an editor's focus tree. The core package supports browser and terminal adapters; `@fregat/react-hotkeys` adds hooks for state and registration.

## Read keyboard state

Use these React hooks for held-key indicators and shortcut hints:

| Hook                     | Result                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `useHeldKeys()`          | The currently held key names.                                                                                              |
| `useHeldKeyCodes()`      | A map from held key names to their physical `event.code` values.                                                           |
| `useKeyHold('Shift')`    | Whether that key is held, including while other keys are pressed.                                                          |
| `useHotkeyHint('Mod+S')` | Whether the held modifiers should reveal a shortcut hint. Combine it with your action's availability and focus conditions. |

`useKeyHold` is inclusive: holding Shift and then A keeps `useKeyHold('Shift')` true. These values describe the current held state; ordered shortcut steps use a sequence binding. Outside React, `getKeyStateTracker()` exposes the shared tracker and its store. See the [API reference](../packages/hotkeys/docs/api.md#record-shortcuts) and [React package](../packages/react-hotkeys/README.md).

## Register shortcuts

Choose a single binding or a batch of independent bindings:

| Job                            | React hook           | Input                                                          |
| ------------------------------ | -------------------- | -------------------------------------------------------------- |
| One stroke                     | `useHotkey`          | A hotkey such as `'Mod+S'`.                                    |
| One ordered sequence           | `useHotkeySequence`  | Steps such as `['G', 'G']`, pressed in order for one callback. |
| Several single-stroke bindings | `useHotkeys`         | An array of `{ hotkey, callback, options? }` definitions.      |
| Several sequence bindings      | `useHotkeySequences` | An array of `{ sequence, callback, options? }` definitions.    |

`useHotkey` also accepts a raw hotkey object. The sequence hooks take arrays of hotkey strings. The registration hooks use the document registry and unregister their bindings when the component unmounts. `HotkeysProvider` supplies defaults; batch options apply in the order provider defaults, common options, then per-definition options. The [React API](../packages/hotkeys/docs/api.md#react) describes targets, enabled state, and provider defaults.

The core registry uses one `register` method for both a stroke and an ordered sequence. Keep each handle and unregister it when its owner is removed:

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

function mountShortcuts(onSave: () => void, onTop: () => void): () => void {
  const registry = getHotkeyRegistry()
  const save = registry.register('Mod+S', onSave)
  const top = registry.register(['G', 'G'], onTop, { ignoreInputs: true })

  return () => {
    save.unregister()
    top.unregister()
  }
}

const cleanup = mountShortcuts(
  () => console.log('Save requested'),
  () => window.scrollTo({ top: 0 }),
)
// Call cleanup() when the view unmounts.
```

Within a stroke, `+` joins modifiers to a key: `Mod+S`. `Mod` means Command on macOS and Control elsewhere. Pass an array for a registry or React sequence. Dispatcher keymaps also accept space-separated strokes, such as `keys: 'Mod+K Mod+C'`; the single-hotkey parsing functions parse one stroke. See [parsing and formatting](../packages/hotkeys/docs/api.md#parse-match-and-format) and [chord syntax](../packages/hotkeys/docs/keymaps.md#chords).

## Build editor keymaps

Use a dispatcher when a key's command depends on focus. The [runnable getting-started example](getting-started.md#one-shortcut-two-commands) creates a workspace, textarea, and sidebar: `Mod+B` toggles the sidebar at workspace focus and toggles bold styling at editor focus.

`createBrowserDispatcher` attaches focus nodes to DOM elements. Each node carries a context and command handlers, and a parent connects it to the surrounding workspace. The dispatcher resolves the key against that focus path. Own the dispatcher for the view's lifetime and call `dispose()` during teardown. `createDispatcher` exposes the same engine for hosts that supply their own input and focus, including terminals.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/key-resolution.dark.svg">
  <img alt="A key press follows the focus path, ranks matching bindings, and runs the first handler that accepts it." src="assets/key-resolution.light.svg">
</picture>

Keep the detailed policy in the guides:

- [Contexts and the focus tree](../packages/hotkeys/docs/concepts.md#the-focus-tree) explain where a command can run.
- [Ranking and user overrides](../packages/hotkeys/docs/keymaps.md#ranking) explain which binding wins and how a user removes or replaces one.
- [Chords](../packages/hotkeys/docs/keymaps.md#chords) cover pending prefixes, timeouts, and replay.
- [Terminal adapters](../packages/hotkeys/docs/keymaps.md#terminals) accept parsed terminal keys, including Kitty keyboard input.
- [Display APIs](../packages/hotkeys/docs/api.md#parse-match-and-format) and [recorders](../packages/hotkeys/docs/api.md#record-shortcuts) support shortcut labels and settings screens.

The current React registration hooks use the document registry. For focus contexts, use the core dispatcher shown above.

Version 0.0.x APIs can change between releases. The [lookup benchmark](../packages/hotkeys/docs/performance.md) times a 255-binding table. Run `bun bench/lookup.ts` from `packages/hotkeys`; its timings describe that machine and run.

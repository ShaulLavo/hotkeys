# @fregat/hotkeys

Keyboard shortcut registration, chords, context-aware keymaps, and display formatting for browser and terminal apps.

## Install

Install a commit-pinned tarball from [hotkeys releases](https://github.com/ShaulLavo/hotkeys/releases), as described in the [installation guide](https://github.com/ShaulLavo/hotkeys/blob/main/docs/development.md#install).

## Use

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

function mountShortcuts(onSave: () => void): () => void {
  const save = getHotkeyRegistry().register('Mod+S', onSave)
  return () => save.unregister()
}

const cleanup = mountShortcuts(() => console.log('Save requested'))
// Call cleanup() when the view unmounts.
```

`Mod` is Command on macOS and Control elsewhere.

[API](docs/api.md) · [Concepts](docs/concepts.md) · [Keymap rules](docs/keymaps.md) · [Troubleshooting](docs/troubleshooting.md) · [React hooks](https://github.com/ShaulLavo/hotkeys/tree/main/packages/react-hotkeys)

[MIT](LICENSE). Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys).

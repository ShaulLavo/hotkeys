# @shaulavo/hotkeys

Keyboard shortcuts, chords, focus-aware keymaps, and display formatting for browser and terminal apps, with optional React hooks.

## Install

```sh
bun add @shaulavo/hotkeys
```

```ts
import { createBrowserDispatcher, registerHotkey } from '@shaulavo/hotkeys'

const save = registerHotkey('Mod+S', () => console.log('Save'))
const keys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace' },
    { keys: 'Mod+B', command: 'text.bold', context: 'Editor' },
  ],
})
const ws = keys.createNode({ context: 'Workspace', commands: { 'sidebar.toggle': () => {} } })
const ed = keys.createNode({ parent: ws, context: 'Editor', commands: { 'text.bold': () => {} } })
keys.attachElement(ws, document.body)
ed.focus()
// Call save.dispose() and keys.dispose() on teardown.
```

Subpaths: `./react`, `./terminal`, `./adapter`. [API](docs/api.md) · [Concepts](docs/concepts.md) · [Keymaps](docs/keymaps.md) · [Performance](docs/performance.md) · [Troubleshooting](docs/troubleshooting.md)

[MIT](LICENSE). Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys).

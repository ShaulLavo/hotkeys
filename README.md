# hotkeys

Keyboard shortcuts, chords, and focus-aware keymaps for browser and terminal apps, with optional React hooks.

## Run from source

```sh
bun install --frozen-lockfile && bun run verify
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

[Get started](docs/getting-started.md) · [Overview](docs/overview.md) · [Concepts](packages/hotkeys/docs/concepts.md) · [API](packages/hotkeys/docs/api.md) · [React](packages/hotkeys/docs/api.md#react) · [Development](docs/development.md)

[MIT](LICENSE). Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys), with Tanner Linsley's copyright retained.

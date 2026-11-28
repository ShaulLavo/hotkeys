# @shaulavo/hotkeys

Keyboard shortcuts, chords, focus-aware keymaps, display formatting, and React hooks for browser and terminal apps. Requires Node `>=24`, and React `>=19.2.0` for `@shaulavo/hotkeys/react`.

```bash
bun add @shaulavo/hotkeys
```

```tsx
import { registerHotkey } from '@shaulavo/hotkeys'
import { createHotkeysContext } from '@shaulavo/hotkeys/react'

const App = createHotkeysContext<{ toggle: void; bold: void }>()
const keymap = [
  { keys: 'Mod+B', command: 'toggle', context: 'Workspace' },
  { keys: 'Mod+B', command: 'bold', context: 'Editor' },
] as const
export const Workspace = (p: { onToggle: () => void; onBold: () => void }) => (
  <App.HotkeysProvider keymap={keymap}>
    <App.FocusScope context='Workspace' commands={{ toggle: p.onToggle }}>
      <App.FocusScope context='Editor' commands={{ bold: p.onBold }}>
        <textarea />
      </App.FocusScope>
    </App.FocusScope>
  </App.HotkeysProvider>
)
registerHotkey('Mod+S', () => {}).dispose()
```

Entrypoints: `.`, `./react`, `./terminal`, `./adapter`. Docs: [API](docs/api.md) · [Concepts](docs/concepts.md) · [Keymaps](docs/keymaps.md) · [Performance](docs/performance.md) · [Troubleshooting](docs/troubleshooting.md)

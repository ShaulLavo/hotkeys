# @shaulavo/hotkeys

Keyboard shortcuts, chords, focus-aware keymaps, and React hooks for browser and terminal apps. Requires Node `>=24`, and React `>=19.2.0` for `@shaulavo/hotkeys/react`.

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

[Getting started](docs/getting-started.md) · [Overview](docs/overview.md) · [API](packages/hotkeys/docs/api.md) · [Keymaps](packages/hotkeys/docs/keymaps.md) · [Development](docs/development.md)

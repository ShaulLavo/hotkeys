# @fregat/react-hotkeys

React hooks for registering, recording, and displaying shortcuts with `@fregat/hotkeys`.

## Install

Install both commit-pinned tarballs from [hotkeys releases](https://github.com/ShaulLavo/hotkeys/releases), as described in the [installation guide](https://github.com/ShaulLavo/hotkeys/blob/main/docs/development.md#install). Supply `react` and `react-dom` 18 or newer in your app.

## Use

```tsx
import { useHotkey, formatForDisplay } from '@fregat/react-hotkeys'

export function SaveButton({ onSave }: { onSave: () => void }) {
  useHotkey('Mod+S', onSave)
  return <button onClick={onSave}>Save {formatForDisplay('Mod+S')}</button>
}
```

[Hooks and API](https://github.com/ShaulLavo/hotkeys/blob/main/packages/hotkeys/docs/api.md) · [Keymap rules](https://github.com/ShaulLavo/hotkeys/blob/main/packages/hotkeys/docs/keymaps.md) · [Core](https://github.com/ShaulLavo/hotkeys/tree/main/packages/hotkeys)

[MIT](LICENSE). Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys).

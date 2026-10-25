# hotkeys

Keyboard shortcuts, context-aware keymaps, and chords for browser and terminal apps, with optional React hooks.

## Run from source

Use Bun 1.4.4 and Node 24 or newer.

```sh
git clone https://github.com/ShaulLavo/hotkeys.git
cd hotkeys
bun install --frozen-lockfile
bun run verify
```

## Use

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

const save = getHotkeyRegistry().register('Mod+S', () => console.log('Save requested'))
save.unregister()
```

[Install release tarballs](docs/development.md#install) · [Concepts](packages/hotkeys/docs/concepts.md) · [API](packages/hotkeys/docs/api.md) · [React](packages/react-hotkeys/README.md) · [Development and releases](docs/development.md) · [Overview](docs/overview.md)

[MIT](LICENSE). Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys), with Tanner Linsley's copyright retained.

# Get started

Install `@shaulavo/hotkeys` from npm or a [local checkout](development.md#install):

```sh
bun add @shaulavo/hotkeys
```

To use `@shaulavo/hotkeys/react`, also install `react`, `react-dom`, and `@tanstack/react-store`.

## Route one shortcut by focus

In this example, `Mod+B` toggles a sidebar when the workspace has focus and toggles bold text when the editor has focus. `Mod` means Command on macOS and Control on Windows and Linux.

Run this code in a browser after `document.body` exists. It builds a focusable workspace, a textarea editor, and a sidebar, then binds a typed command map to them.

```ts
import { createBrowserDispatcher } from '@shaulavo/hotkeys'

type WorkspaceCommands = {
  'sidebar.toggle': void
  'text.bold': void
}

function mountWorkspace(): () => void {
  const workspaceElement = document.createElement('section')
  workspaceElement.tabIndex = 0
  workspaceElement.setAttribute('aria-label', 'Workspace')
  const editorElement = document.createElement('textarea')
  editorElement.setAttribute('aria-label', 'Editor')
  editorElement.value = 'Press Mod+B here to toggle bold.'
  const sidebarElement = document.createElement('aside')
  sidebarElement.textContent = 'Sidebar'
  workspaceElement.append(editorElement, sidebarElement)
  document.body.append(workspaceElement)

  const keys = createBrowserDispatcher<WorkspaceCommands>({
    root: workspaceElement,
    keymap: [
      { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace' },
      { keys: 'Mod+B', command: 'text.bold', context: 'Editor' },
    ],
  })
  const workspace = keys.createNode({
    context: 'Workspace',
    commands: {
      'sidebar.toggle'() {
        sidebarElement.hidden = !sidebarElement.hidden
      },
    },
  })
  const editor = keys.createNode({
    parent: workspace,
    context: 'Editor',
    commands: {
      'text.bold'() {
        editorElement.style.fontWeight =
          editorElement.style.fontWeight === 'bold' ? 'normal' : 'bold'
      },
    },
  })
  keys.attachElement(workspace, workspaceElement)
  keys.attachElement(editor, editorElement)
  workspaceElement.focus()

  return () => {
    keys.dispose()
    workspaceElement.remove()
  }
}

const cleanup = mountWorkspace()
// Call cleanup() when the view unmounts.
```

Press `Mod+B` to hide or show the sidebar. Press Tab to move focus into the editor, then press `Mod+B` again to toggle bold text. Press Shift+Tab to return to the workspace.

The dispatcher reads the active focus path and evaluates each binding's `context` predicate against it. See [the focus tree](../packages/hotkeys/docs/concepts.md#the-focus-tree), [chords](../packages/hotkeys/docs/keymaps.md#chords), and [removing bindings](../packages/hotkeys/docs/keymaps.md#removing-bindings) for the resolution rules.

## Register a single shortcut

When a shortcut does not depend on a focus tree, call `registerHotkey` on the shared document registry. Keep the returned handle and call `dispose()` during teardown.

```ts
import { registerHotkey } from '@shaulavo/hotkeys'

function mountShortcuts(onSave: () => void): () => void {
  const save = registerHotkey('Mod+S', onSave)
  return () => save.dispose()
}

const cleanup = mountShortcuts(() => console.log('Save requested'))
// Call cleanup() when the view unmounts.
```

`HotkeyRegistration`, `HotkeyRegistry`, dispatchers, recorders, and `KeyStateTracker` also implement `Symbol.dispose` for `using` declarations.

## Validate and format user bindings

User settings often arrive as unvalidated strings. Call `parseShortcut` to validate the string and narrow it to a `Shortcut` that `registerHotkey`, `normalizeHotkey`, and `formatForDisplay` accept without type casts.

```ts
import { formatForDisplay, normalizeHotkey, parseShortcut, registerHotkey } from '@shaulavo/hotkeys'

function bindUserShortcut(input: string, onSave: () => void): string | null {
  const parsed = parseShortcut(input)
  if (!parsed.ok) return null

  const registration = registerHotkey(parsed.value, onSave)
  const stored = normalizeHotkey(parsed.value)
  const label = formatForDisplay(parsed.value)
  registration.dispose()
  return `${stored} (${label})`
}

bindUserShortcut('Mod+S', () => console.log('Save'))
```

`normalizeHotkey` defaults to `mode: 'symbolic'`, so literal `Control` and `Meta` keep their meaning and `Mod` stays `Mod`. Pass `{ mode: 'resolved', platform }` to resolve `Mod` for a specific platform, or `{ mode: 'adaptive', platform }` to fold a platform's primary modifier into `Mod`.

## Choose an entrypoint by job

| Job                        | Entrypoint                   | Key APIs                                                                                       | Guide                                                                              |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Route commands by focus    | `@shaulavo/hotkeys`          | `createBrowserDispatcher`, `createDispatcher`, `explainKeymap`                                 | [Build editor keymaps](overview.md#build-editor-keymaps)                           |
| Register document bindings | `@shaulavo/hotkeys`          | `registerHotkey`, `createHotkeyRegistry`, `getHotkeyRegistry`                                  | [Register shortcuts](overview.md#register-shortcuts)                               |
| Parse, validate, format    | `@shaulavo/hotkeys`          | `parseShortcut`, `parseHotkey`, `normalizeHotkey`, `formatForDisplay`, `areHotkeysEqual`       | [Parse, match, and format](../packages/hotkeys/docs/api.md#parse-match-and-format) |
| Use React hooks            | `@shaulavo/hotkeys/react`    | `HotkeysProvider`, `useHotkey`, `useHotkeys`, `useHotkeySequence`, `useHotkeySequences`        | [React API](../packages/hotkeys/docs/api.md#react)                                 |
| Read held keyboard state   | `@shaulavo/hotkeys/react`    | `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, `useHotkeyHint`                                | [Read keyboard state](overview.md#read-keyboard-state)                             |
| Handle terminal input      | `@shaulavo/hotkeys/terminal` | `createTerminalDispatcher`, `keyInputFromTerminalKey`, `terminalKeyEffects`                    | [Terminals](../packages/hotkeys/docs/keymaps.md#terminals)                         |
| Build a custom host        | `@shaulavo/hotkeys/adapter`  | `createChordRuntime`, `buildKeymapTrie`, `trieStep`, `resolveKeymapNode`, `attachKeyListeners` | [Adapter API](../packages/hotkeys/docs/api.md#adapter)                             |

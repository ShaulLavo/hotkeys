# Get started

Keyboard state, shortcuts, and focus-aware keymaps for browser and terminal apps, with optional React hooks.

Install the packages from [commit-pinned release tarballs](development.md#install).

## One shortcut, two commands

`Mod+B` can toggle bold styling in an editor and toggle a sidebar when the workspace has focus. `Mod` is Command on macOS and Control elsewhere.

Run this in a browser after `document.body` exists. The example creates its own focusable workspace and editor, plus a sidebar.

```ts
import { createBrowserDispatcher } from '@fregat/hotkeys'

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

  const keys = createBrowserDispatcher({
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

Press `Mod+B` to toggle the sidebar, then Tab into the editor and press it again to toggle the editor's text weight. Shift+Tab returns to the workspace. The dispatcher resolves the same key against the focused node's context. See [contexts](../packages/hotkeys/docs/concepts.md#the-focus-tree), [chords](../packages/hotkeys/docs/keymaps.md#chords), and [user overrides](../packages/hotkeys/docs/keymaps.md#removing-bindings) for the resolution rules.

## Choose an API by job

| Job                  | APIs                                                                                                                          | Guide                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Read keyboard state  | `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, `useHotkeyHint`                                                               | [Held state and hints](overview.md#read-keyboard-state)               |
| Register shortcuts   | `useHotkey` for one stroke, `useHotkeySequence` for ordered steps; `useHotkeys` and `useHotkeySequences` for separate batches | [Registration and lifecycle](overview.md#register-shortcuts)          |
| Build editor keymaps | `createBrowserDispatcher` for DOM focus, `createDispatcher` for a host-supplied focus tree                                    | [Commands, contexts, and overrides](overview.md#build-editor-keymaps) |

The React state hooks observe held keys. `useKeyHold('Shift')` stays true when another key is also pressed. A shortcut sequence matches ordered presses for one binding; a batch registers several independent bindings. See the [React package](../packages/react-hotkeys/README.md) for installation and a component example.

## Register a simple shortcut

For a callback while a view is mounted, use the document registry and keep its cleanup handle:

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

function mountShortcuts(onSave: () => void): () => void {
  const save = getHotkeyRegistry().register('Mod+S', onSave)
  return () => save.unregister()
}

const cleanup = mountShortcuts(() => console.log('Save requested'))
// Call cleanup() when the view unmounts.
```

Use a dispatcher when the same key needs different commands by focused context. The registry is the shared registration layer for a document; a view owns and disposes any dispatcher it creates.

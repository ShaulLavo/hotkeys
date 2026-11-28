# Overview

`@shaulavo/hotkeys` separates keyboard parsing, chord state, focus-tree dispatch, and framework bindings into one ESM package with four explicit entrypoints. Every entrypoint uses named exports without wildcard re-exports.

## Runtime requirements and entrypoints

The package targets Node `>=24` and modern browsers. React integration uses React 19 context values, ref cleanup functions, and `useEffectEvent`, so `@shaulavo/hotkeys/react` requires `react >=19.2.0`, `react-dom >=19.2.0`, and `@tanstack/react-store ^0.11.1` as optional peer dependencies. Non-React apps do not install React.

| Entrypoint                   | Purpose                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shaulavo/hotkeys`          | Shortcut parsing, formatting, matching, one-line registration, `HotkeyRegistry`, focus-tree `createDispatcher` and `createBrowserDispatcher`, `explainKeymap`, recorders, and `KeyStateTracker`.                            |
| `@shaulavo/hotkeys/react`    | Typed and untyped `HotkeysProvider`, `FocusScope`, `useFocusNode`, `useHotkeysDispatcher`, `usePendingChord`, `useHotkey`, `useHotkeySequence`, `useHotkeys`, `useHotkeyRegistrations`, held-key hooks, and recorder hooks. |
| `@shaulavo/hotkeys/terminal` | `createTerminalDispatcher`, `keyInputFromTerminalKey`, and `terminalKeyEffects` for terminal and TUI event loops.                                                                                                           |
| `@shaulavo/hotkeys/adapter`  | Low-level trie, chord runtime, predicate evaluation, and browser listener primitives for custom host adapters.                                                                                                              |

Subpath bundles import shared helpers from `@shaulavo/hotkeys` as external references, so a consumer pays for one copy of the core runtime.

## Two dispatch pipelines

Applications usually need one of two models, and `@shaulavo/hotkeys` keeps them separate so their rules never collide.

### Focus-aware keymaps

`createBrowserDispatcher` and `createDispatcher` bind a declarative table of `KeymapEntry` objects to a tree of `FocusNode` instances. Each node attaches to a DOM element or logical pane and publishes a `KeyContext`. When a key arrives, the dispatcher walks from the focused node to the root, ranks matching bindings by context depth, source rank, and table order, and runs command handlers from deepest node upward until one accepts the command. Returning `false` declines the command and tries the next handler or binding.

Use this pipeline for workspaces, editors, terminals, palettes, and any view where the same shortcut triggers different commands depending on focus.

### Document hotkey registry

`registerHotkey`, `getHotkeyRegistry`, and `createHotkeyRegistry` bind callbacks directly to strokes or chords on a document or element target. Internally, a `HotkeyRegistry` owns its own `BrowserDispatcher`, compiles its active registrations lazily on the next key event, and filters availability to its own entry IDs.

Use this pipeline for standalone page shortcuts, modal Escape handlers, or quick bindings that do not need a focus tree.

### Pipeline ownership in React

`HotkeysProvider` keeps these two pipelines explicit and non-overlapping:

- Focus hooks (`FocusScope`, `useFocusNode`, `useHotkeysDispatcher`, `usePendingChord`) always bind to the provider's `BrowserDispatcher`, configured with either an external `dispatcher` prop or a provider-owned `keymap` prop. Passing both is a type error. Calling `useFocusNode` or `FocusScope` without either throws an explicit error.
- Registration hooks (`useHotkey`, `useHotkeySequence`, `useHotkeys`, `useHotkeyRegistrations`) always bind to `props.registry ?? getHotkeyRegistry()`. When a hook omits `target` or passes `target: null`, it forwards `target: undefined` to the active registry so that registry binds to its own document.
- If an app mounts both a focus dispatcher and registration hooks, they run as independent DOM listeners. To resolve conflicts and focus precedence in one place, put all shortcuts in the focus keymap.

## Typed commands and hosted widgets

`createHotkeysContext<Commands>()` creates a private React context parameterized by your command map. Child components use that context's `FocusScope` and `useFocusNode` hooks, so TypeScript rejects unknown command names and wrong argument shapes across the tree.

Embedded widgets such as terminal panes or code editors often define their own command names without knowing the host's closed command map. A typed host calls `dispatcher.asHosted()` to get a `HostedBrowserDispatcher` and passes its `FocusNode` directly as a covariant `HostedFocusNode` parent. The host keeps strict command typing on its own API while embedded widgets attach child nodes and validate `event.args` at runtime.

```tsx
import { createBrowserDispatcher } from '@shaulavo/hotkeys'
import type { HostedBrowserDispatcher, HostedFocusNode, KeymapEntry } from '@shaulavo/hotkeys'

type AppCommands = {
  'sidebar.toggle': void
  'tab.select': { index: number }
}

const keymap: readonly KeymapEntry<AppCommands>[] = [
  { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace' },
  { keys: 'Mod+1', command: 'tab.select', args: { index: 0 }, context: 'Workspace' },
]

function mountWidget(hosted: HostedBrowserDispatcher, parent: HostedFocusNode, el: HTMLElement) {
  const widget = hosted.createNode({
    parent,
    context: 'Terminal',
    commands: {
      'terminal.clear': () => {},
    },
  })
  const detach = hosted.attachElement(widget, el)
  return () => {
    detach()
    widget.remove()
  }
}

export function createWorkspaceHost(root: HTMLElement, widgetEl: HTMLElement) {
  const dispatcher = createBrowserDispatcher<AppCommands>({ root, keymap })
  const workspace = dispatcher.createNode({
    context: 'Workspace',
    commands: {
      'sidebar.toggle': () => {},
      'tab.select': ({ args }) => void args.index,
    },
  })
  const detachWorkspace = dispatcher.attachElement(workspace, root)
  const unmountWidget = mountWidget(dispatcher.asHosted(), workspace, widgetEl)

  return () => {
    unmountWidget()
    detachWorkspace()
    dispatcher.dispose()
  }
}
```

## Uniform disposal

Every long-lived handle and instance (`HotkeyRegistration`, `HotkeyRegistry`, `Dispatcher`, `BrowserDispatcher`, `TerminalDispatcher`, `HotkeyRecorder`, `HotkeySequenceRecorder`, and `KeyStateTracker`) implements both `.dispose()` and `[Symbol.dispose]()`, so you can clean them up manually or with `using`. Lightweight listener attachments (`node.handle`, `dispatcher.attachElement`, `dispatcher.observeKeys`, `dispatcher.subscribePending`) return a `() => void` cleanup function.

## Next steps

- Follow [Getting started](getting-started.md) for React focus trees, settings rebinding, and terminal dispatch.
- Read [Concepts](../packages/hotkeys/docs/concepts.md) for key resolution, normalization modes, chords, and tracker lifetime.
- Read [Keymaps](../packages/hotkeys/docs/keymaps.md) for context predicates, precedence, and `dispatcher.explain()`.
- Read the [API reference](../packages/hotkeys/docs/api.md) for every export across all four entrypoints.

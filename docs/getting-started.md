# Getting started

This guide installs `@shaulavo/hotkeys`, builds a typed focus-aware React workspace, adds a shortcut settings and rebinding flow, and shows one-line registration and terminal dispatch.

## Install

Install `@shaulavo/hotkeys`. Requires Node `>=24`.

```bash
bun add @shaulavo/hotkeys
```

If you use `@shaulavo/hotkeys/react`, install the optional peer dependencies (`react >=19.2.0`, `react-dom >=19.2.0`, and `@tanstack/react-store ^0.11.1`).

```bash
bun add react react-dom @tanstack/react-store
```

## Build a typed focus-aware React workspace

Create a private typed context with `createHotkeysContext<Commands>()`. Pass `keymap` to `HotkeysProvider` so the provider owns a `BrowserDispatcher` lifecycle, nest `FocusScope` or `useFocusNode` for each region, and read in-progress chords with `usePendingChord()`.

Multiple `useFocusNode` calls attached to the same `(element, parent)` share one focus node on the dispatcher, merge their contexts dynamically, and clean up their own handlers independently.

```tsx
import { formatForDisplay } from '@shaulavo/hotkeys'
import { createHotkeysContext } from '@shaulavo/hotkeys/react'
import type { KeymapEntry } from '@shaulavo/hotkeys'

type AppCommands = {
  'sidebar.toggle': void
  'text.bold': void
  'tab.select': { index: number }
  'editor.comment': void
}

const AppHotkeys = createHotkeysContext<AppCommands>()

const keymap: readonly KeymapEntry<AppCommands>[] = [
  { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace' },
  { keys: 'Mod+B', command: 'text.bold', context: 'Editor' },
  { keys: 'Mod+1', command: 'tab.select', args: { index: 0 }, context: 'Workspace' },
  { keys: 'Mod+K Mod+C', command: 'editor.comment', context: 'Editor' },
]

function EditorPane({ onBold, onComment }: { onBold: () => void; onComment: () => void }) {
  const { ref } = AppHotkeys.useFocusNode({
    context: 'Editor',
    commands: {
      'text.bold': onBold,
      'editor.comment': onComment,
    },
  })
  return <textarea ref={ref} aria-label='Editor' />
}

function PendingChordBadge() {
  const pending = AppHotkeys.usePendingChord()
  if (!pending) return null
  return (
    <output aria-live='polite'>
      {formatForDisplay(pending.keys)} ({pending.candidateCount})
    </output>
  )
}

export function Workspace(props: {
  onToggleSidebar: () => void
  onSelectTab: (index: number) => void
  onBold: () => void
  onComment: () => void
}) {
  return (
    <AppHotkeys.HotkeysProvider keymap={keymap}>
      <AppHotkeys.FocusScope
        context='Workspace'
        commands={{
          'sidebar.toggle': props.onToggleSidebar,
          'tab.select': ({ args }) => props.onSelectTab(args.index),
        }}
      >
        <EditorPane onBold={props.onBold} onComment={props.onComment} />
        <PendingChordBadge />
      </AppHotkeys.FocusScope>
    </AppHotkeys.HotkeysProvider>
  )
}
```

To use an externally created dispatcher instead of a provider-owned keymap, pass `dispatcher={myDispatcher}` and omit `keymap`. The provider attaches focus nodes and subscribes `usePendingChord()` to your dispatcher without disposing it on unmount.

## Validate, record, and rebind user shortcuts

When shortcuts come from user input, settings files, or a recorder, validate them with `parseShortcut`. A successful parse narrows the string to a branded `Shortcut` accepted directly by `registerHotkey`, `useHotkey`, `useHotkeys`, `formatForDisplay`, and `KeymapEntry` with no type casts.

Normalize with `normalizeHotkey` using the mode you need:

- `mode: 'symbolic'` (default) preserves `Mod`, `Control`, and `Meta` as written, suited for saving preferences.
- `mode: 'resolved'` resolves `Mod` for the target platform, suited for runtime comparison and pending-chord labels.
- `mode: 'adaptive'` folds the platform's primary modifier into `Mod` for portable settings.

In React, pass a stable `id` on each row of `useHotkeys`. Reordering rows keeps the existing registration handle and `triggerCount`. Rebinding the same `id` to new keys replaces the old handle cleanly. `useHotkeys` accepts both single-stroke `hotkey` entries and multi-stroke `sequence` entries in one list.

```tsx
import { useState } from 'react'
import { formatForDisplay, normalizeHotkey, parseShortcut } from '@shaulavo/hotkeys'
import { useHotkeyRecorder, useHotkeys } from '@shaulavo/hotkeys/react'
import type { Shortcut } from '@shaulavo/hotkeys'

function parseInitialShortcut(text: string): Shortcut {
  const result = parseShortcut(text)
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Invalid shortcut')
  return result.value
}

export function ShortcutSettings(props: { onSave: () => void; onJumpTop: () => void }) {
  const [saveBinding, setSaveBinding] = useState<Shortcut>(() => parseInitialShortcut('Mod+S'))
  const [draft, setDraft] = useState(() => normalizeHotkey(saveBinding))
  const [error, setError] = useState<string | null>(null)

  const recorder = useHotkeyRecorder({
    modifierMode: 'adaptive',
    detectConflicts: true,
    onRecord: (recorded) => {
      const parsed = parseShortcut(recorded)
      if (!parsed.ok) return
      setSaveBinding(parsed.value)
      setDraft(normalizeHotkey(parsed.value))
      setError(null)
    },
    onReject: (rejection) => setError(rejection.message),
  })

  useHotkeys([
    { id: 'save', hotkey: saveBinding, callback: props.onSave },
    { id: 'jump-top', sequence: ['G', 'G'], callback: props.onJumpTop },
  ])

  function applyDraft() {
    const parsed = parseShortcut(draft)
    if (!parsed.ok) {
      setError(parsed.errors.map((item) => `${item.token}: ${item.message}`).join(', '))
      return
    }
    if (parsed.warnings.length > 0) {
      setError(parsed.warnings[0]?.message ?? 'Unknown key')
      return
    }
    setSaveBinding(parsed.value)
    setDraft(normalizeHotkey(parsed.value))
    setError(null)
  }

  return (
    <div>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type='button' onClick={applyDraft}>
        Apply ({formatForDisplay(saveBinding)})
      </button>
      <button type='button' onClick={recorder.startRecording}>
        {recorder.isRecording ? 'Press a shortcut...' : 'Record'}
      </button>
      {error && <p role='alert'>{error}</p>}
    </div>
  )
}
```

## Register standalone shortcuts without a focus tree

For quick document or element shortcuts outside React, call `registerHotkey`. Dispose the returned handle when done, or scope its lifetime with `using`.

```ts
import { createHotkeyRegistry, registerHotkey } from '@shaulavo/hotkeys'

const save = registerHotkey('Mod+S', (event, { shortcut, stroke }) => {
  event.preventDefault()
  console.log(shortcut, stroke.modifiers)
})

// Later, release the binding.
save.dispose()

// For an isolated document (such as an iframe) or capture-phase listening:
const isolated = createHotkeyRegistry({ document, capture: true })
const close = isolated.register(['G', 'Escape'], () => {})
close.dispose()
isolated.dispose()
```

## Dispatch terminal keys

For terminal apps and TUIs, import `createTerminalDispatcher` from `@shaulavo/hotkeys/terminal`. It pairs `createDispatcher` with `keyInputFromTerminalKey` and `terminalKeyEffects`.

```ts
import { createTerminalDispatcher } from '@shaulavo/hotkeys/terminal'
import type { TerminalKeyLike } from '@shaulavo/hotkeys/terminal'

type TuiCommands = { quit: void; 'pane.next': void }

const dispatcher = createTerminalDispatcher<TerminalKeyLike, TuiCommands>({
  platform: 'linux',
  keymap: [
    { keys: 'Control+Q', command: 'quit' },
    { keys: 'Control+K N', command: 'pane.next' },
  ],
})

const root = dispatcher.createNode({
  commands: {
    quit: () => {},
    'pane.next': () => {},
  },
})
root.focus()

export function onTerminalKey(event: TerminalKeyLike): boolean {
  return dispatcher.handleTerminalKey(event)
}
```

## Next steps

- Read [Concepts](../packages/hotkeys/docs/concepts.md) for key resolution, `KeyStateTracker` singleton lifetime, and chord rules.
- Read [Keymaps](../packages/hotkeys/docs/keymaps.md) for predicates, unbinding, and `dispatcher.explain()`.
- Read the [API reference](../packages/hotkeys/docs/api.md) for every function, hook, and type.

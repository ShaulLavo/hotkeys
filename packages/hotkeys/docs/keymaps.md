# Keymaps

How a dispatcher compiles a keymap, selects bindings, explains resolution, and drives chords.

## Contexts

Each focus node publishes a context of identifiers and `key=value` pairs in Zed's shorthand, such as `'Editor extension=md'`. The path from the outermost node to the focused node forms the context stack.

A binding's `context` field is a predicate over that stack. Supported syntax includes identifiers, `key == value`, `!=`, prefix `!`, `&&`, `||`, parentheses, and `>` for descendant matching (`Workspace > !Terminal`). A binding with no `context` matches everywhere.

## Compiling and validating entries

`compileKeymap(entries, platform)` and `dispatcher.setKeymap(entries)` validate every entry's `keys` with the same strict grammar as `parseShortcut`. Literal `+` keys such as `'+'`, `'Mod++'`, and `'Control++'` are valid. Malformed bindings such as `'Mdo+S'`, `'Mod+'`, or modifier-only strokes throw an error naming the entry index, stroke index, and failing token.

`dispatcher.setKeymap(entries)` compiles and validates the entire replacement table before mutating dispatcher state. If any entry fails validation, the previous keymap, pending chord, and revision stay unchanged.

`compileKeymap` builds the chord trie once and stores it on `compiled.root`. Both `createDispatcher` and `setKeymap` pass that prebuilt trie directly into the chord runtime without compiling it a second time.

## Ranking

When multiple bindings match a key, candidates rank in this order:

1. Deepest context matched by their predicate.
2. Source rank: `user`, then `pack`, then `base`, then `default`.
3. Table order, with later entries winning ties.

The deepest matching context takes the key, and at equal context depth a `user` entry outranks a `pack` entry. In this example, `Mod+B` makes text bold in a markdown editor and toggles the sidebar everywhere else, until the user unbinds the markdown action:

```ts
type AppCommands = {
  'sidebar.toggle': void
  'markdown.bold': void
}

const hotkeys = createBrowserDispatcher<AppCommands>({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace', source: 'default' },
    {
      keys: 'Mod+B',
      command: 'markdown.bold',
      context: 'Editor && extension == md',
      source: 'pack',
    },
    // The user removes markdown.bold in the editor so Workspace's binding takes over.
    { keys: 'Mod+B', unbind: 'markdown.bold', context: 'Editor', source: 'user' },
  ],
})
const workspace = hotkeys.createNode({
  context: 'Workspace',
  commands: { 'sidebar.toggle': () => toggleSidebar() },
})
const editor = hotkeys.createNode({
  parent: workspace,
  context: 'Editor extension=md',
  commands: { 'markdown.bold': () => bold() },
})
hotkeys.attachElement(workspace, shellElement)
hotkeys.attachElement(editor, editorElement)
```

## Removing bindings

Two entry forms remove bindings where their `context` matches:

- `{ keys, unbind: 'command' }` removes that specific key and command pair and leaves other commands on the same keys active.
- `{ keys, command: null }` removes every binding on those keys from equal and weaker sources.

Targeted removals compare resolved chord strings (`normalizeHotkey(chord, { mode: 'resolved', platform })`), so `'Mod+K'` and `'Control+K'` match on Linux and Windows, and `'Mod+K'` and `'Meta+K'` match on macOS.

These removal rules also govern pending prefixes. If `K C` binds both `one` and `two`, unbinding `two` leaves `one` reachable so `K` still waits for `C`. A weaker source's `command: null` cannot hide a stronger surviving chord. Pending counts count distinct surviving chord paths, so two commands on `K C` count as one continuation.

## Inspecting resolution with `explain`

Call `dispatcher.explain(input, options?)` or `explainKeymap(keymap, input, options?)` to see why a binding won, lost, or was shadowed without running handlers or mutating pending state:

```ts
const report = hotkeys.explain('Mod+K Mod+C')
// report.blockedByPrefix: non-null when an earlier prefix stops live dispatch from waiting
// report.active: ordered winning bindings (empty when blocked by a known prefix blocker)
// report.candidates: every entry at the final node with status, depth, rank, and blockedByIndex
// report.continuations: longer chords below the node with pending or shadowed-by-prefix status
// report.pending: whether live dispatch waits for a continuation
```

`explain` evaluates a single chord against one fixed `contextStack` snapshot (either `dispatcher.contextStack()` or `options.contextStack`). It mirrors live trie matching across multiple edges, prefix cutoffs, and `KeyInput[]` stream filtering (ignoring idle `keyup`, `composing`, and modifier-only events, declining repeated chord prefixes on stroke 0, and skipping repeated or modifier-only events while a chord is pending). It does not simulate mid-chord context mutations or mismatch replay.

When `isAvailable` is configured, pass `options.sources` with one source per stroke (or `options.source` for a single-stroke query). If a stroke has no source, `explain` marks availability as `'availability-unknown'` instead of guessing.

Candidate order from `explain` reflects keymap resolution only. At runtime, a winning command's handler can still return `false` to decline.

## Declining a command

A handler that returns `false` declines the command. The dispatcher tries the next ancestor node for that command, then advances to the next candidate binding. If nothing claims the key, default input handling runs.

```ts
editor.handle('editor.indent', () => {
  if (!hasSelection()) return false // Tab falls through to the next binding.
  indent()
})
```

Call `dispatchCommand('editor.indent')` to run a command along the current focus path without a key event, or `dispatchCommandFrom(node, 'editor.indent')` to target a specific node's path without moving focus.

## Chords

Space-separated strokes form chords. While an eligible longer chord keeps input pending, the dispatcher holds its prefix from the page. If neither an exact binding nor an eligible continuation matches, the key keeps its default input handling.

- A bound pending prefix waits `timeoutMs` (1000 ms by default) for a continuation, then tries its exact bindings. A bound prefix with no eligible continuation runs immediately.
- An unbound prefix waits for the next key. It also times out when `acceptsTextInput(source)` is true and the buffered stroke is printable or `Space` without Control or Meta.
- Once a timeout starts, each advancing stroke restarts it, including through unbound prefixes.
- A key that does not continue the chord ends it. The runtime tries the longest bound buffered prefix first. Remaining buffered keys can combine with the new key into another chord, or replay before the new key matches from scratch.
- When every candidate for a buffered prefix declines, each stroke of that prefix replays once in order with its original input and source while the operation stays active. Shorter bindings inside that replayed prefix are not retried.
- When a chord completes and every handler declines, earlier buffered strokes replay and the current event keeps its default handling. A successful claim or explicit `preventDefault: true` or `stopPropagation: true` retains ownership instead of replaying.
- A pending chord belongs to the focus under which it started and ends on focus change, blur, hidden tab, or pointer down.

```ts
const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+K', command: 'search.open' },
    { keys: 'Mod+K Mod+C', command: 'comment.add' },
  ],
  onPendingChange: (pending) => showChordHint(pending?.keys ?? null),
  onSequence: (event) => console.log('chord', event.outcome, event.elapsedMs),
})
```

To attach multiple UI listeners to pending state, call `hotkeys.subscribePending(listener)`. `hotkeys.pending()` returns a frozen object that stays referentially equal while unchanged.

### Callbacks and nested input

Handlers, replay callbacks, and notifications may call `handleKey` synchronously. A completing chord clears `pending()` and its timer before its handler runs. Each dispatch keeps its own buffered input and sequence metadata, so a `G H` handler can start `X Y` without clearing the new pending `X`.

Ordinary nested input preserves outer candidate fallback and replay with their original inputs and sources. If a nested call starts or completes a chord, the outer mismatch operation stops resuming suffixes or matching its current key over that newer activity. Remaining old buffered keys replay while the operation stays active, and the current unclaimed key passes through normally.

`cancel`, disabling, keymap replacement, disposal, and focus changes stop remaining fallback and replay, even after the pending buffer is detached. An input handler that disposes the dispatcher after the first replayed character prevents later characters from being inserted. Interrupted recovery reports its cancellation reason rather than a later timeout or mismatch. Disposal suppresses later sequence reports.

Keyboard dispatch checks for interruption between handlers for the same command on the same node and its ancestors. Fresh input captures focus before selecting or consuming a binding so a focus change cannot leave a prefix pending under the previous focus.

A handler returning `true` keeps ownership of its input even if it synchronously cancels or disposes the runtime. A completed chord still reports `'completed'` after cancellation or a focus change, while disposal stops later sequence reports. `releaseAll()` or a nested release of the same key clears held-key ownership even while a handler is running.

Keymap replacement commits before its cancellation notifications run, so nested input from those notifications sees the replacement keymap. Pending notifications always deliver the latest state. If a listener cancels or replaces a pending chord during notification, stale outer notifications abort immediately.

### Prefix ordering

At a prefix node, exact bindings are filtered by context and `isAvailable`, ranked by context depth, source, and later table position, and pruned by removals. The first surviving exact binding sets a table-index cutoff. Only longer chords listed after that binding can keep the prefix pending. Longer chords listed before it are shadowed for that lookup.

With both bindings eligible, these two tables behave differently on `Control+K`:

```ts
// Waits for Control+C. On timeout, tries search.open.
const waitsForContinuation = [
  { keys: 'Control+K', command: 'search.open' },
  { keys: 'Control+K Control+C', command: 'comment.add' },
]

// Runs search.open immediately because the earlier chord sits before the cutoff.
const runsSearchImmediately = [
  { keys: 'Control+K Control+C', command: 'comment.add' },
  { keys: 'Control+K', command: 'search.open' },
]
```

Context depth and source choose the winning exact binding that sets the cutoff. A continuation is not re-compared against that winner's depth or source. Its table index determines whether it passes the cutoff.

A continuation must also match the current context and `isAvailable` check. An inactive continuation cannot keep a bound prefix pending. Each continuation's full candidate set resolves removals before the cutoff applies, so a removal listed before the exact prefix still removes a later continuation.

If a higher-priority trie edge at a stroke has no eligible bindings or continuations, the dispatcher continues to lower-priority matching edges (for example, falling through from an ineligible logical binding to an eligible physical `[Code]` binding).

## Terminals

Import `createTerminalDispatcher` from `@shaulavo/hotkeys/terminal` for terminal hosts. It wires `keyInputFromTerminalKey` and `terminalKeyEffects` into a DOM-free dispatcher. `keyInputFromTerminalKey` accepts parsed terminal keys in OpenTUI's `KeyEvent` shape (legacy escape sequences and the Kitty keyboard protocol), mapping legacy Alt to `Alt` rather than desktop `Meta`.

```ts
import { createTerminalDispatcher } from '@shaulavo/hotkeys/terminal'
import type { TerminalKeyLike } from '@shaulavo/hotkeys/terminal'

type TuiCommands = {
  'settings.open': void
}

const hotkeys = createTerminalDispatcher<TerminalKeyLike, TuiCommands>({
  platform: 'linux',
  keymap: [{ keys: 'Control+K S', command: 'settings.open' }],
  replay: (_input, event) => shell.write(encode(event)),
})
hotkeys.createNode({ commands: { 'settings.open': () => openSettings() } }).focus()

renderer.keyInput.on('keypress', (event) => {
  if (!hotkeys.handleTerminalKey(event)) shell.write(encode(event))
})
```

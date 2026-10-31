# keymaps

how a dispatcher picks a binding for a key, and what happens around chords

## contexts

each focus node publishes a context: identifiers and `key=value` pairs in zed's shorthand, such as `'Editor extension=md'`. the path from the outermost node to the focused one forms the context stack

a binding's `context` is a predicate over that stack: identifiers, `key == value`, `!=`, prefix `!`, `&&`, `||`, parentheses, and `>` for descendant (`Workspace > !Terminal`). a binding with no `context` matches everywhere

## ranking

when several bindings match a key, candidates rank by:

1. the deepest context their predicate matches
2. source: `user` over `pack` over `base` over `default`
3. later entries in the table first

so the deepest matching context takes the key, and among equal contexts a user binding outranks a keybinding pack. here `Mod+B` makes text bold in a markdown editor and toggles the sidebar everywhere else, until the user takes it back

```ts
const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace', source: 'default' },
    {
      keys: 'Mod+B',
      command: 'markdown.bold',
      context: 'Editor && extension == md',
      source: 'pack',
    },
    // the user takes the key back from the markdown pack
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

## removing bindings

`{ keys, unbind: 'command' }` removes one key→command pair where its context matches and leaves other commands on those keys. `command: null` removes every binding on the keys for equal and weaker sources where its context matches

these rules also decide whether a chord prefix waits. if `K C` runs `one` and `two`, unbinding `two` leaves `one` reachable: `K` still waits for `C`. a weaker source's null removal cannot hide a stronger surviving chord. pending counts represent distinct surviving chord paths, so two commands on `K C` count as one continuation

nothing refuses a collision. `bindingsForInput(compileKeymap(entries, platform), keys, stack)` reports what a key would run under a given context stack, for settings screens

## declining a command

a handler that returns `false` passes the command to the next ancestor, and then the key to the next candidate binding. when nothing takes the key it goes to default input handling

```ts
editor.handle('editor.indent', () => {
  if (!hasSelection()) return false // Tab falls through to the next binding
  indent()
})
```

`dispatchCommand('editor.indent')` runs a command along the focus path without a key

## chords

strokes separated by spaces form a chord. when an eligible longer chord keeps the input pending, the dispatcher holds its prefix from the page. if no exact binding or eligible continuation matches, the key keeps its default input handling

- a pending prefix that is itself bound waits `timeoutMs` (one second by default) for its continuation, then tries its exact bindings. a bound prefix with no eligible continuation runs immediately; ordering can exclude a continuation, as described below
- an unbound prefix normally waits for the next key. it also times out when `acceptsTextInput(source)` is true and the buffered stroke is printable or `Space`, without Control or Meta
- once a timeout starts, it restarts as the chord advances, including through unbound prefixes
- a key that does not continue the chord ends it: the longest bound buffered prefix is tried first. remaining buffered keys may combine with the new key into another chord; otherwise they are replayed or resolved before the new key is matched from scratch
- when every candidate for a buffered prefix declines, every stroke of that prefix is replayed once, in order, with its original input and source, while the operation remains active. shorter bindings inside that replayed prefix are not tried again
- when a chord completes but every handler declines, its earlier buffered strokes are replayed and the current event keeps its normal input handling. a successful claim or explicit `preventDefault: true` / `stopPropagation: true` retains ownership instead of replaying the chord
- a pending chord belongs to the focus it started under. it ends on focus change, blur, a hidden tab or pointer down

```ts
const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+K', command: 'search.open' },
    { keys: 'Mod+K Mod+C', command: 'comment.add' },
  ],
  onPendingChange: (pending) => showChordHint(pending?.keys ?? null),
  onSequence: (event) => log('chord', event.outcome, event.elapsedMs),
})
```

### callbacks and nested input

handlers, replay callbacks and notifications may call `handleKey` synchronously. a completing chord leaves `pending()` and clears its timer before its handler runs. each operation keeps its own buffered input and sequence metadata, so a `G H` handler can start `X Y` without its completion clearing the new pending `X`

ordinary nested input preserves outer candidate fallback and replay with their original inputs and sources. if a nested call starts or completes a chord, the older mismatch operation does not resume a suffix or match its current key again over that newer activity. any remaining old buffered input is replayed while the operation remains active; the current unclaimed key passes through normally

`cancel`, disabling, keymap replacement, disposal and focus changes interrupt remaining fallback and replay. this also applies after the pending buffer has been detached: an input handler that disposes the dispatcher after the first replayed character prevents subsequent characters from being inserted. interrupted recovery reports its cancellation reason instead of a later ordinary timeout or mismatch; disposal suppresses that later report

keyboard dispatch checks interruption between handlers for the same command too, including other handlers on the same node and its ancestors. fresh input captures its focus before selecting or consuming a binding, so a focus change cannot leave a new prefix pending under the old focus

a handler that returns `true` keeps ownership of its input even if it synchronously cancels or disposes the runtime. a successful completion can still report `completed` after cancellation or a focus change, while disposal stops later sequence reports. cancellation alone does not claim a declined fresh single-key shortcut. `releaseAll()` or a nested release of the same key clears held-key ownership even when a handler is still running

keymap replacement is committed before its cancellation notifications run. nested input from those notifications sees the replacement map. pending notifications describe the latest state; an older notification cannot overwrite a newer pending label

### prefix ordering

first, the exact bindings for the buffered keys are filtered by context and availability, ranked by context depth, source, then later table position, and processed for removals. the first remaining exact binding sets a cutoff: only longer chords listed **after that binding** can keep the prefix pending. longer chords listed before it are shadowed for this lookup

with both bindings eligible, these tables behave differently on `Control+K`:

```ts
// waits for Control+C; on timeout, tries search.open
const waitsForContinuation = [
  { keys: 'Control+K', command: 'search.open' },
  { keys: 'Control+K Control+C', command: 'comment.add' },
]

// tries search.open immediately; the earlier chord cannot keep the prefix pending
const runsSearchImmediately = [
  { keys: 'Control+K Control+C', command: 'comment.add' },
  { keys: 'Control+K', command: 'search.open' },
]
```

context depth and source choose the exact binding that sets the cutoff. an earlier exact binding can therefore set it ahead of a later, lower-ranked exact binding. the continuation is not compared against that winner's depth or source again: its table position decides whether it passes the cutoff

the continuation must still match the current context and pass the dispatcher's `isAvailable` check, when supplied. an inactive continuation does not make a bound prefix wait. if the exact binding is inactive, another exact binding may set the cutoff; if none survives, there is no exact-binding cutoff. shadowing therefore depends on the current context and availability, not just the table in isolation

each continuation's complete candidate set is ranked and processed for removals before the cutoff is applied to surviving commands. a removal listed before the exact prefix can therefore still remove a later continuation. the cutoff does not discard removals or change the resolution policy for the complete chord

## terminals

`keyInputFromTerminalKey` reads keys parsed from terminal input (opentui's `KeyEvent` shape: legacy escapes and the kitty protocol). legacy Alt arrives as Alt, never as the desktop Meta key. a terminal host runs the dom-free dispatcher and sends replayed keys to the shell

```ts
import { createDispatcher, keyInputFromTerminalKey, terminalKeyEffects } from '@fregat/hotkeys'
import type { TerminalKeyLike } from '@fregat/hotkeys'

const hotkeys = createDispatcher<TerminalKeyLike>({
  keymap: [{ keys: 'Control+K S', command: 'settings.open' }],
  effects: terminalKeyEffects,
  replay: (input, event) => shell.write(encode(event)),
})
hotkeys.createNode({ commands: { 'settings.open': () => openSettings() } }).focus()

renderer.keyInput.on('keypress', (event) => {
  if (!hotkeys.handleKey(keyInputFromTerminalKey(event), event)) shell.write(encode(event))
})
```

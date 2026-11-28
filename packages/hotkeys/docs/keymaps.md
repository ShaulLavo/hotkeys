# Keymaps

A keymap is an ordered array of `KeymapEntry` objects compiled once into a stroke trie and evaluated against the focused node's context stack.

## Keymap entries

Each entry is either a `Binding` or an `Unbinding`:

- **Binding:** `{ keys, command, args?, context?, source?, preventDefault?, stopPropagation? }`.
  - `keys` accepts a `Hotkey`, `RawHotkey`, `HotkeySequence`, `Shortcut`, or space-separated chord string such as `'Mod+K Mod+C'`.
  - `command: null` clears bindings from equal and weaker sources for the same stroke when its `context` matches.
- **Unbinding:** `{ keys, unbind, context?, source? }`.
  - Removes a specific command name (`unbind`) on the exact resolved chord when its `context` matches, leaving other commands bound to the same keys intact.

`compileKeymap(entries, platform)` and `dispatcher.setKeymap(entries)` validate every entry's `keys` through `parseShortcut`. Malformed entries (such as `'Mdo+S'` or `'Mod+'`) throw an error naming the entry index, stroke index, and failing token. If `setKeymap` throws, the previous active keymap and pending chord remain unchanged.

## Contexts and predicates

Each `FocusNode` carries a `KeyContext` with boolean `identifiers` and `key=value` pairs. You can pass a shorthand string (`'Editor mode=full extension=md'`), a `KeyContextInit` object (`{ identifiers: ['Editor'], values: { extension: 'md' } }`), or a live `readContext` function sampled on each key press.

Predicates use this grammar, from loosest to tightest precedence:

| Operator   | Meaning                                                      | Example                            |
| ---------- | ------------------------------------------------------------ | ---------------------------------- |
| `>`        | Descendant: left matches an ancestor, right matches below it | `Workspace > Editor`               |
| `\|\|`     | Logical OR                                                   | `Editor \|\| Terminal`             |
| `&&`       | Logical AND                                                  | `Editor && extension == md`        |
| `==`, `!=` | Key-value equality or inequality (missing keys satisfy `!=`) | `mode != vim`                      |
| `!`        | Negation across the entire context stack                     | `!Modal`                           |
| `( ... )`  | Explicit grouping                                            | `(Editor \|\| Terminal) && !Modal` |

An identifier predicate such as `extension` matches both the identifier `'extension'` and any `extension=...` value entry.

## Precedence and resolution order

When a key matches a trie node, `resolveKeymapNode` evaluates available candidates against the context stack (ordered root-to-leaf) and sorts matching entries by:

1. **Context depth (deepest first):** a predicate matching closer to the focused leaf beats an ancestor predicate. A binding with no `context` matches at full stack depth.
2. **Source rank (strongest first):** `'user'` (3) > `'pack'` (2) > `'base'` (1) > `'default'` (0). Entries without `source` default to `'user'`.
3. **Table order (later first):** later entries in the array win ties.

After sorting, `command: null` suppresses entries of equal or weaker source rank, and `unbind` suppresses matching `(resolved chord, command)` pairs. Live dispatch then runs surviving bindings in order; for each binding, handlers run from the focused node up to the root until one returns anything other than `false`.

## Typed commands and hosted widgets

Parameterize `createBrowserDispatcher<AppCommands>`, `createDispatcher<Source, AppCommands>`, `createTerminalDispatcher<Source, AppCommands>`, or `createHotkeysContext<AppCommands>()` with a `CommandMap`:

```ts
type AppCommands = {
  'sidebar.toggle': void
  'tab.select': { index: number }
}
```

- Commands whose payload is `void` or includes `undefined` make `args` optional in `KeymapEntry`, `dispatchCommand`, and `dispatchCommandFrom`.
- Commands with a non-optional payload require `args` everywhere and infer `event.args` inside command handlers.
- To host an embedded widget (such as a terminal or editor component) without widening `AppCommands` with an index signature, pass `dispatcher.asHosted()` as `HostedBrowserDispatcher` and your `FocusNode` directly as `HostedFocusNode`. The widget attaches child nodes under that parent and validates `event.args` at runtime.

## Inspecting resolution with `dispatcher.explain()`

`dispatcher.explain(input, options?)` and `explainKeymap(keymap, input, options?)` run a pure, read-only lookup over a fixed `contextStack` snapshot without invoking handlers, changing focus, or touching pending timers.

- Accepts a `HotkeyInput`, chord string, or `readonly KeyInput[]` event stream.
- Walks every proper prefix of a multi-stroke chord over the full subtree below each prefix node to match live `resolveKeymapNode` behavior:
  - If an earlier prefix fires immediately with `pending === 0` and an active binding, `blockedByPrefix` has `kind: 'shadowed-by-prefix'` with `winningBinding`, `active` is `[]`, and final candidates receive `status: 'shadowed-by-prefix'` with `blockedByIndex`.
  - If an earlier prefix has `pending === 0` and no active binding (for example, rejected by `isAvailable` or context mismatch on all descendants), `blockedByPrefix` has `kind: 'prefix-unavailable'`.
  - If any surviving descendant keeps the prefix pending (for example `[K C, K, K X]`), `K` pends and `K C` stays reachable.
- Applies the same intermediate-prefix check to `continuations`, distinguishing `'pending'` continuations from `'shadowed-by-prefix'` descendants.
- When `isAvailable` is configured, pass per-stroke `sources: [event0, event1]` (or `source` for single-stroke queries). Any stroke missing a source reports `'availability-unknown'` instead of guessing.
- Note that `explain` reports binding precedence, not runtime handler acceptance; a handler can still return `false` when dispatched. Also, `explain` inspects a single chord against a fixed context stack and does not simulate mismatch replay or root retry.

## Chords, replay, and terminal keymaps

- Use `dispatcher.pending()` and `dispatcher.subscribePending(listener)` (or `usePendingChord()` in React) to render pending chords.
- Use `onSequence` to observe completed, unmatched, unavailable, timed-out, blurred, hidden, pointer-cancelled, superseded, disabled, or disposed chords.
- For terminals, use `createTerminalDispatcher` from `@shaulavo/hotkeys/terminal`. Supply a `replay` callback if your terminal host re-encodes unclaimed buffered chord prefixes back to the PTY or shell.

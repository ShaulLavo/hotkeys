# Troubleshooting

When a shortcut fails to fire or behaves unexpectedly, check these causes from top to bottom.

## Nothing fires

1. **The focus node is not attached.** `createBrowserDispatcher` focuses the deepest node attached to an element on the event path. Call `attachElement(node, element)` for every node that should receive DOM key events.
2. **The key pressed outside `root`.** `createBrowserDispatcher` listens on `root`, which defaults to `document`. Keys fired outside an element `root` are ignored.
3. **Another listener called `preventDefault()`.** A dispatcher skips a `keydown` whose `defaultPrevented` is already true. Pass `capture: true` to hear keys ahead of descendant handlers.
4. **The handler returned `false`.** Returning `false` declines the command and passes the key along. Check for an accidental `return false`.
5. **The platform resolved `Mod` differently.** `Mod` means Command on macOS and Control on Windows and Linux. Without `navigator` (tests or server rendering), `detectPlatform()` returns `'linux'`. Pass `platform: 'mac'` to override it.

## A shortcut string or keymap throws on setup

`parseShortcut`, `registerHotkey`, `compileKeymap`, and `dispatcher.setKeymap` reject malformed tokens instead of dropping them silently.

- Unknown modifiers such as `'Mdo+S'` and trailing separators such as `'Mod+'` fail with the stroke index and failing token.
- Literal `+` shortcuts use `'+'`, `'Mod++'`, `'Control++'`, or `'Mod+Plus'`.
- For user-entered settings, call `parseShortcut(input)` first and check `parsed.ok` before passing `parsed.value` to `registerHotkey` or `setKeymap`.
- When `dispatcher.setKeymap(entries)` throws, the previous active keymap remains intact.

## Punctuation or another keyboard layout behaves differently

Bind the printed symbol when the shortcut means that character: `?` and `Control++` accept Shift used to produce the glyph. Bind `Shift+[Slash]` or `Control+[KeyE]` when physical key position and exact modifiers matter.

Letters always require exact Shift matching, and accented Latin letters do not fall back to unaccented letter shortcuts. See [Printed keys and physical keys](concepts.md#printed-keys-and-physical-keys) for edge priority and fallback rules.

## It works outside inputs but not inside

`registerHotkey` and `getHotkeyRegistry().register` skip shortcuts inside text fields unless you set `ignoreInputs: false`. By default, `ignoreInputs` is `true` for bare keys and Shift or Alt combinations, and `false` for Control and Meta combinations and `Escape`.

In React, pass `ignoreInputs` in the third argument or set it on `HotkeysProvider`:

```tsx
useHotkey('G', goToTop, { ignoreInputs: false })

<HotkeysProvider defaultOptions={{ hotkey: { ignoreInputs: false } }}>{app}</HotkeysProvider>
```

A dispatcher has no `ignoreInputs` option. Bound keys run wherever focus sits, including text fields, unless their `context` excludes inputs. Attach a context such as `TextInput` to the input node and bind with `Workspace && !TextInput`. `acceptsTextInput` only makes a printable chord prefix pend with a timeout so `replay` can restore the character when no chord follows.

## A different binding runs than expected

Inspect the active context stack and run `dispatcher.explain` for the shortcut:

```ts
console.log(hotkeys.contextStack())
console.log(hotkeys.explain('Mod+K Mod+C'))
```

Check `report.blockedByPrefix`, `report.active`, `report.candidates`, and `report.continuations`. Deepest matching context ranks ahead of source (`user`, `pack`, `base`, `default`) and table order. For keymaps compiled outside a dispatcher, call `explainKeymap(compiled, 'Mod+K Mod+C', { contextStack })`. See [Ranking](keymaps.md#ranking) and [Inspecting resolution with `explain`](keymaps.md#inspecting-resolution-with-explain).

## A chord ends too early

Log `onSequence` to see why the chord closed:

```ts
createBrowserDispatcher({
  keymap,
  onSequence: (event) => console.log(event.keys, event.outcome, event.elapsedMs),
})
```

- `completed`: a bound chord ran.
- `timeout`: a pending prefix reached `timeoutMs` (1000 ms by default). The runtime tries bound prefixes and replays unbound printable input in text fields. See [Chords](keymaps.md#chords).
- `unmatched`: the next key did not match a continuation edge.
- `unavailable`: `isAvailable` filtered the matching bindings out.
- `blur`, `hidden`, `pointer`, `superseded`: the window lost focus, the tab hid, a pointer pressed, or focus or keymap changed.
- `disabled`, `disposed`: the runtime turned off or was disposed.

## Characters vanish after a chord prefix

When a pending prefix mismatches or its candidates decline, the runtime hands each unclaimed buffered stroke to `replay` in order. `createBrowserDispatcher` defaults `replay` to `replayTextInput` to restore typed characters in text fields. In a terminal host, supply `replay` to write encoded keys to the shell. The current unclaimed event passes through normally, so `replay` must not insert it twice.

Replay stops if a callback cancels, disables, replaces the keymap, disposes the runtime, or moves focus. Check replayed `input` and `beforeinput` listeners too, because they can trigger those changes after the first restored character. See [Callbacks and nested input](keymaps.md#callbacks-and-nested-input).

## The same shortcut warns about a conflict

Registering the same shortcut twice on the same target logs a warning and keeps both registrations. For both `keydown` and `keyup`, the newest eligible handler runs first and returning `false` passes the key to the next handler. Set `conflictBehavior` to `'replace'` to remove the previous registration, `'error'` to throw, or `'allow'` to silence the warning.

## Holding a key repeats the callback

Set `requireReset: true` on a single-stroke registration. The callback fires once per press and re-arms after the key or a modifier is released.

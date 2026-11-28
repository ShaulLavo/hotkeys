# Troubleshooting

## `useFocusNode requires a HotkeysProvider with a dispatcher or keymap`

**Cause:** You called `useFocusNode` or rendered `<FocusScope>` outside a matching `HotkeysProvider`, or inside a registry-only `HotkeysProvider` that has neither `dispatcher` nor `keymap`. If you created a typed context with `createHotkeysContext<AppCommands>()`, the provider and child hooks must come from that same context object.

**Fix:** Wrap the tree in `<HotkeysProvider keymap={keymap}>` or `<HotkeysProvider dispatcher={dispatcher}>`, using the same context returned by `createHotkeysContext()` if typed.

## Shortcut does not fire inside an input, textarea, or contenteditable element

**Cause:** For `registerHotkey` and `useHotkey`, `ignoreInputs` defaults to `true` for bare keys and `Shift` or `Alt` combinations (and `false` for `Control`, `Meta`, and `Escape`). Input elements include `<input>` (except `button`, `submit`, and `reset`), `<textarea>`, `<select>`, `contentEditable`, and elements with an `EditContext`.

**Fix:** Pass `{ ignoreInputs: false }` on the registration when a bare or `Alt` shortcut should fire while typing, or attach `target` directly to the input element itself.

## Shortcut in `useHotkey` and a `FocusScope` keymap both fire or clash

**Cause:** `HotkeysProvider` runs the focus dispatcher (`dispatcher` or `keymap`) and the document `HotkeyRegistry` (`useHotkey`, `useHotkeySequence`, `useHotkeys`) as separate DOM pipelines.

**Fix:** Move shortcuts that share conflict resolution or focus precedence into the focus dispatcher's `keymap` and handle them in `<FocusScope>` or `useFocusNode`.

## `useHotkey` fires on the wrong document in an iframe or multi-window app

**Cause:** Without a custom `registry`, registration hooks bind to `getHotkeyRegistry()` on the global `document`.

**Fix:** Create a registry for the target document with `createHotkeyRegistry({ document: iframeDoc })` and pass it to `<HotkeysProvider registry={iframeRegistry}>`. Omit `target` (or pass `target: null`) on `useHotkey` and `useHotkeys` so the hook binds to the registry's own document. Note that passing an unresolved `RefObject` (`ref.current === null`) defers registration until the element mounts.

## `useHotkeys` throws `Duplicate useHotkeys id`

**Cause:** Two rows in the same `useHotkeys` call share the same `id`. Planning throws before mutating live registrations and rolls back cleanly.

**Fix:** Give each row in a `useHotkeys` batch a unique `id`, or omit `id` when rows do not need stable identity across reordering.

## A chord never completes or gets shadowed by a shorter shortcut

**Cause:** A shorter prefix (such as `K` when `K C` is also bound) wins without keeping the chord pending, a context predicate does not match the focused stack, or `isAvailable` rejects an earlier stroke.

**Fix:** Call `dispatcher.explain('K C')` (or `dispatcher.explain('K')` to inspect `continuations`) and check `blockedByPrefix`, `candidates`, and `continuations`:

- `blockedByPrefix.kind === 'shadowed-by-prefix'` names the `winningBinding` that fires immediately before the next stroke.
- `blockedByPrefix.kind === 'prefix-unavailable'` means an earlier stroke failed `isAvailable` or context matching for all descendants.
- `status: 'context-mismatch'` means the entry's `context` predicate did not match `dispatcher.contextStack()`.

## `parseShortcut`, `compileKeymap`, or `setKeymap` throws on a shortcut string

**Cause:** Keymap compilation uses the strict `parseShortcut` grammar. Common mistakes:

- Misspelled modifier (`'Mdo+S'`): fix the modifier name.
- Trailing single `'+'` (`'Mod+'`): to bind the literal plus key, write `'Mod++'` or `'Mod+Plus'`.
- Modifier-only stroke (`'Control+Shift'`): add a non-modifier key.
- Unclosed physical bracket (`'[KeyS'`): write `'[KeyS]'` or `{ code: 'KeyS' }`.

A failed `dispatcher.setKeymap` throws before mutating state, leaving the previous keymap active.

## `KeyStateTracker` or `useKeyHold` reports a stuck key

**Cause:** The OS or an external tool swallowed a `keyup` event (for example, clipboard utilities, dictation tools, or system shortcuts).

**Fix:** The tracker automatically clears non-modifier keys when a modifier releases and resets on window `blur` and hidden tab visibility. If your app detects dropped keyups from an external source, call `getKeyStateTracker().reset()`. In tests, call `KeyStateTracker.resetInstance()` between cases so listeners and held state do not leak across tests.

## Left and right `Shift` interfere when checking held state

**Cause:** `useHeldKeyCodes()` returns `Record<string, string>` keyed by logical name (`'Shift'`), so holding both sides overwrites the single `'Shift'` slot.

**Fix:** Use `useKeyHold('[ShiftLeft]')` and `useKeyHold('[ShiftRight]')` (or `getKeyStateTracker().isKeyHeld('[ShiftLeft]')`), which read `activeCodes` and track each physical side independently until released.

## React hooks during server rendering (SSR)

All hooks in `@shaulavo/hotkeys/react` render safely on the server without `window` or `document`:

- `useHotkeysDispatcher()` and `usePendingChord()` return `null`.
- `useFocusNode(...)` returns `{ ref, node: null, dispatcher: null }`.
- `useHotkeyRegistrations()` returns `{ hotkeys: [], sequences: [] }`.
- `useHeldKeys()` returns `[]`, `useHeldKeyCodes()` returns `{}`, and `useKeyHold` and `useHotkeyHint` return `false`.
- `useHotkeyRecorder` and `useHotkeySequenceRecorder` return idle states (`isRecording: false`).

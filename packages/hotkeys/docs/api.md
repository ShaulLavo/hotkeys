# API reference

Every public export of `@shaulavo/hotkeys`, grouped by entrypoint and job. The root entrypoint manifest lives in [`src/index.ts`](../src/index.ts).

`@shaulavo/hotkeys` ships four explicit entrypoints:

- `@shaulavo/hotkeys` for registration, focus dispatch, diagnostics, parsing, formatting, and recording.
- `@shaulavo/hotkeys/terminal` for parsed terminal key events.
- `@shaulavo/hotkeys/adapter` for low-level trie, predicate, chord runtime, and DOM listener helpers.
- `@shaulavo/hotkeys/react` for React hooks over the document registry, held-key state, and recorders.

## Register shortcuts

| Export                                              | Behavior                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `registerHotkey(keys, callback, options?)`          | Registers a stroke or sequence on the target document's shared registry and returns a `HotkeyRegistration`.                                            |
| `getHotkeyRegistry(doc?)`                           | Returns the shared `HotkeyRegistry` for a document, creating it on first use.                                                                          |
| `createHotkeyRegistry(options?)`                    | Creates an owned `HotkeyRegistry`. Accepts `{ document?, timeoutMs?, capture? }`.                                                                      |
| `HotkeyRegistry.register(keys, callback, options?)` | Registers a stroke or sequence and returns a handle with `dispose()`, `[Symbol.dispose]()`, `setOptions`, `replaceOptions`, and a settable `callback`. |
| `HotkeyRegistry.registrations`                      | TanStack Store holding `ReadonlyMap<string, HotkeyRegistrationView>` for command palettes and devtools.                                                |
| `HotkeyRegistry.trigger(id)`                        | Runs a registration callback without a keyboard event and returns whether the registration existed.                                                    |
| `HotkeyRegistry.dispatcher`                         | Exposes the underlying `BrowserDispatcher`.                                                                                                            |
| `HotkeyRegistry.dispose()`                          | Removes listeners and clears every registration in the registry. Also available as `[Symbol.dispose]()`.                                               |
| `findHotkeyConflicts(candidate, options?)`          | Lists live registrations that collide with a candidate stroke or sequence, including prefix overlap.                                                   |

`HotkeyOptions` accepts `conflictBehavior` (`'warn'` by default, or `'error'`, `'replace'`, `'allow'`), `enabled`, `eventType` (`'keydown'` or `'keyup'`), `ignoreInputs`, `platform`, `preventDefault`, `requireReset`, `stopPropagation`, `target`, and `meta`.

Every callback receives `(event, context)`, where `context` is `HotkeyCallbackContext`:

- `shortcut`: canonical string for the full binding (`'Mod+S'` or `'G I'`).
- `strokes`: frozen array of resolved `ParsedHotkey` objects in order.
- `stroke`: completing `ParsedHotkey` (`strokes.at(-1)`).

`HotkeyRegistrationView` returns frozen `strokes` and `options` snapshots so readers cannot mutate live registry state.

Both `keydown` and `keyup` registrations run newest first and pass the event to the next matching registration when a callback returns `false`.

If publishing a new registration to `registrations` subscribers throws, `register` removes that call's entry and command handler before rethrowing the original error. Other registrations stay intact, and a prior `conflictBehavior: 'replace'` removal is not undone.

### Update a registration

`handle.setOptions(patch)` merges the provided fields into the current configuration and preserves omitted fields. `handle.replaceOptions(options)` replaces the configuration so omitted fields return to their defaults. Setting any field to `undefined` restores its default. When `ignoreInputs` is unset, Control and Meta combinations and `Escape` fire inside text fields, while bare keys and Shift or Alt combinations are skipped.

Both setters preserve the handle, registration order, `callback`, and `triggerCount`. Changing `platform` reparses the original strokes so `Mod` follows the new platform while literal `Control` and `Meta` keep their meaning. Changing `target` moves scope inside the registry's document without moving the document listener. A target from another document throws before mutating the registration. Call `createHotkeyRegistry({ document: otherDocument })` for another document.

Changes to matching or event behavior cancel any pending chord. Changes to `target`, `platform`, or `eventType` also re-arm `requireReset`. Metadata updates, `callback` swaps, and no-op option updates preserve pending input. Changing `target`, `eventType`, or resolved keys checks conflicts with the active `conflictBehavior`, and a rejected update leaves the existing registration active. Option updates on a disposed handle do nothing.

## Route keys by focus

| Export                                                 | Behavior                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `createBrowserDispatcher<Commands>(options?)`          | Creates a `BrowserDispatcher` with DOM listeners, `attachElement`, `nodeForElement`, `claimKeybinding`, `observeKeys`, and `asHosted`. |
| `createDispatcher<Source, Commands>(options?)`         | Creates a DOM-free `Dispatcher` for custom or headless hosts.                                                                          |
| `Dispatcher.createNode(options?)`                      | Creates a `FocusNode` with `parent`, `context` or `readContext`, and `commands`.                                                       |
| `Dispatcher.focus(node)`                               | Moves focus to an owned node or `null`.                                                                                                |
| `Dispatcher.focused()`                                 | Returns the focused `FocusNode` or `null`.                                                                                             |
| `Dispatcher.hasNode(node)`                             | Returns whether the dispatcher owns the node and its entire ancestor chain.                                                            |
| `Dispatcher.contextStack()`                            | Returns non-empty contexts from the outermost node to the focused node.                                                                |
| `Dispatcher.setKeymap(entries)`                        | Compiles and validates the full table, then swaps the active keymap. Failed compilation leaves the prior keymap active.                |
| `Dispatcher.handleKey(input, source, inScope?)`        | Offers one `KeyInput` and returns whether a binding claimed it.                                                                        |
| `Dispatcher.dispatchCommand(command, args?)`           | Runs a command along the current focus path without a key event.                                                                       |
| `Dispatcher.dispatchCommandFrom(node, command, args?)` | Runs a command along an owned node's path without moving focus.                                                                        |
| `Dispatcher.explain(input, options?)`                  | Inspects how the active keymap resolves a shortcut or `KeyInput` stream without side effects.                                          |
| `Dispatcher.pending()`                                 | Returns the current frozen `PendingChordLabel` or `null`. Referentially stable while unchanged.                                        |
| `Dispatcher.subscribePending(listener)`                | Subscribes to pending-chord changes and returns an unsubscribe function.                                                               |
| `Dispatcher.wantsCapture()`                            | Returns whether a chord is pending or a claimed key is held.                                                                           |
| `Dispatcher.capturesKey(input)`                        | Returns whether a capturing host listener should offer this key ahead of other listeners.                                              |
| `Dispatcher.releaseAll()`                              | Clears held-key ownership after focus loss or tab hide.                                                                                |
| `Dispatcher.cancel(outcome?)`                          | Cancels any pending chord with the given `ChordOutcome`.                                                                               |
| `Dispatcher.dispose()`                                 | Clears nodes, removes listeners, and disposes the chord runtime. Also available as `[Symbol.dispose]()`.                               |
| `compileKeymap<Commands>(entries, platform)`           | Parses and validates entries once into a `CompiledKeymap` with a prebuilt trie in `root`.                                              |
| `explainKeymap(keymap, input, options?)`               | Pure read-only lookup over a `CompiledKeymap` with prefix-shadowing and availability diagnostics.                                      |
| `createKeyContext(init?)`, `parseKeyContext(src)`      | Builds a `KeyContext` from `{ identifiers?, values? }` or shorthand such as `'Editor extension=md'`.                                   |
| `parseContextPredicate(source)`                        | Parses a `context` predicate expression for reuse or inspection.                                                                       |

`DispatcherOptions` accepts `keymap`, `platform`, `effects`, `replay`, `acceptsTextInput`, `isAvailable`, `currentFocus`, `timeoutMs`, `onPendingChange`, `onSequence`, and `onCaptureChange`. `BrowserDispatcherOptions` replaces `effects` with `root`, `capture`, and `beforeKey`.

### Typed commands and hosted widgets

Pass a `CommandMap` type argument to `createBrowserDispatcher<Commands>` or `createDispatcher<Source, Commands>` to type command names and `args` across `KeymapEntry<Commands>`, `FocusNode.handle`, `dispatchCommand`, and `dispatchCommandFrom`. Commands mapped to `void` or a type that includes `undefined` make `args` optional. All other commands require `args`.

When a typed host embeds an external widget such as a terminal or editor, call `dispatcher.asHosted()` to get a `HostedBrowserDispatcher` and pass any `FocusNode<KeyboardEvent, Commands>` directly as a `HostedFocusNode` parent. `HostedFocusNode` exposes read-only `{ id, parent, context }`, so closed host command maps stay strictly typed while embedded widgets attach child nodes without casts and validate `event.args` at runtime.

### Diagnostics with `explain` and `explainKeymap`

`dispatcher.explain(input, options?)` and `explainKeymap(keymap, input, options?)` inspect a shortcut string, `HotkeyInput`, or `readonly KeyInput[]` stream over one fixed `contextStack` snapshot without running handlers, mutating focus, or changing pending timers.

`ExplainOptions` accepts `contextStack`, `sources` (one source per stroke), `source` (shorthand for a single-stroke query), and `isAvailable` (on `explainKeymap`). Each `KeymapExplanation` reports:

- `active`: ordered `CompiledBinding` winners at the queried node, or empty when blocked by an earlier prefix.
- `candidates`: every candidate at the final node with `status` (`'matched'`, `'context-mismatch'`, `'unavailable'`, `'availability-unknown'`, `'unbound'`, `'shadowed'`, or `'shadowed-by-prefix'`), `depth`, `rank`, and `blockedByIndex`.
- `continuations`: descendant chords below the queried node with `status` (`'pending'`, `'shadowed-by-prefix'`, `'unavailable'`, or `'availability-unknown'`) and `shadowedByIndex`.
- `pending`: whether live dispatch would wait for a longer chord.
- `blockedByPrefix`: non-null when an earlier prefix stops live dispatch from reaching this chord, with `kind` (`'shadowed-by-prefix'` or `'prefix-unavailable'`), `strokeIndex`, `winningBinding`, and `availability` (`'known'` or `'unknown'`).
- `mismatchedAtStrokeIndex` and `ignored`: populated when a stroke has no trie edge or when a `KeyInput` is skipped (`'keyup'`, `'composing'`, `'modifier-only'`, `'repeat'`, or `'repeat-on-chord-prefix'`).

## Parse, match, and format

| Export                                           | Behavior                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseShortcut(input)`                           | Validates a stroke, chord string, `RawHotkey`, or stroke array and returns `{ ok: true, value: Shortcut, warnings }` or `{ ok: false, errors, warnings }`. |
| `parseHotkey(input, platform?)`                  | Parses a string, `RawHotkey`, `ParsedHotkey`, `KeyInput`, or `KeyboardEventLike` into a `ParsedHotkey` with `Mod` resolved for `platform`.                 |
| `normalizeHotkey(input, options?)`               | Normalizes a stroke, chord, `ParsedHotkey`, `KeyInput`, or `KeyboardEventLike`. Options: `{ mode?, platform? }`.                                           |
| `formatForDisplay(input, options?)`              | Formats a stroke, chord, or `ParsedHotkey` for UI display, such as `⌘ S` on macOS or `Ctrl+S` on Linux and Windows.                                        |
| `matchesKeyboardEvent(event, hotkey, platform?)` | Tests a `KeyboardEvent` against a `Hotkey` or `ParsedHotkey`.                                                                                              |
| `matchesKeyInput(input, hotkey, platform?)`      | Tests a `KeyInput` against a `Hotkey` or `ParsedHotkey`.                                                                                                   |
| `areHotkeysEqual(left, right, platform?)`        | Compares resolved modifiers and exact logical `key` or physical `code`. Physical codes stay distinct from logical keys.                                    |
| `detectPlatform()`                               | Returns `'mac'`, `'windows'`, or `'linux'`. Defaults to `'linux'` when `navigator` is absent.                                                              |
| `isModifierKey(key)`                             | Returns whether a key name or alias is a modifier token.                                                                                                   |
| `normalizeKeyName(key)`                          | Normalizes DOM key spellings and aliases to canonical names.                                                                                               |
| `createKeyInput(init)`                           | Builds a host-independent `KeyInput`.                                                                                                                      |
| `keyInputFromKeyboardEvent(event, platform?)`    | Converts a browser `KeyboardEventLike` into a `KeyInput`.                                                                                                  |

`parseShortcut` accepts `'+'`, `'Mod++'`, `'Control++'`, `'Ctrl+Shift++'`, and `'Mod+Plus'`, and rejects trailing empty tokens such as `'Mod+'`, unknown modifiers such as `'Mdo+S'`, modifier-only strokes, malformed brackets, and empty sequences. Unknown key names stay `ok: true` and populate `warnings` so callers can enforce `warnings.length === 0`.

`normalizeHotkey` supports three `mode` values:

- `'symbolic'` (default): preserves `Mod`, literal `Control`, and literal `Meta` for storage and settings.
- `'resolved'`: resolves `Mod` for `options.platform ?? detectPlatform()` (`'Mod+S'` becomes `'Meta+S'` on macOS and `'Control+S'` on Linux and Windows).
- `'adaptive'`: folds the platform's primary literal modifier (`Meta` on macOS, `Control` elsewhere) into `'Mod'`.

`formatForDisplay` accepts `FormatDisplayOptions`: `platform`, `useSymbols` (boolean or `{ modifiers?, keys? }`), `parts` (returns `string[]` when `true`), `layoutMap`, `keyLabels`, and `separatorToken`.

## Record shortcuts

| Export                                             | Behavior                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `HotkeyRecorder`                                   | Records a single shortcut into a TanStack Store (`isRecording`, `recordedHotkey`).                  |
| `HotkeySequenceRecorder`                           | Records a multi-stroke sequence into a TanStack Store (`isRecording`, `steps`, `recordedSequence`). |
| `KeyStateTracker`, `getKeyStateTracker()`          | Tracks held key names (`heldKeys`) and physical codes (`heldCodes`) on `window`.                    |
| `matchesHeldModifiers(hotkey, heldKeys, options?)` | Returns whether held modifiers reveal a shortcut hint. Accepts `{ platform?, exact? }`.             |

`HotkeyRecorder`, `HotkeySequenceRecorder`, and `KeyStateTracker` all expose `.dispose()` and `[Symbol.dispose]()`. `KeyStateTracker` also provides `reset()` to clear held state when the host detects lost `keyup` events, plus `getHeldKeys()`, `isKeyHeld(key)`, `isAnyKeyHeld(keys)`, and `areAllKeysHeld(keys)`.

Both recorder classes support `setOptions(patch)` and `replaceOptions(options)`. Replacement requires `onRecord` and removes omitted optional callbacks and settings without stopping an active recording or discarding captured steps. Updating `idleTimeoutMs` on `HotkeySequenceRecorder` restarts its countdown. Removing `idleTimeoutMs` cancels the countdown.

## Terminals

Import terminal helpers from `@shaulavo/hotkeys/terminal`:

| Export                                                 | Behavior                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `createTerminalDispatcher<Source, Commands>(options?)` | Creates a `TerminalDispatcher` wired with `terminalKeyEffects` and a `handleTerminalKey(event)` method. |
| `keyInputFromTerminalKey(event)`                       | Converts a `TerminalKeyLike` event (legacy escapes or Kitty keyboard protocol) into a `KeyInput`.       |
| `terminalKeyEffects`                                   | `KeyEffects<TerminalKeyLike>` calling `preventDefault` and `stopPropagation` when present.              |

Types exported from `@shaulavo/hotkeys/terminal`: `TerminalKeyLike`, `TerminalDispatcher`, and `TerminalDispatcherOptions`.

## Adapter

Import low-level host building blocks from `@shaulavo/hotkeys/adapter`:

| Export                                         | Behavior                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createChordRuntime(options)`                  | Stateful chord trie runtime with pending timeouts, replay, and `updateTrie` / `updateBindings`. |
| `buildKeymapTrie(bindings, platform)`          | Compiles `KeymapBinding[]` into a lookup trie.                                                  |
| `trieStep(node, input)`                        | Advances one stroke in a `KeymapNode`.                                                          |
| `resolveKeymapNode(node, stack, isAvailable?)` | Ranks exact bindings at a node and counts surviving continuations.                              |
| `evaluatePredicate(predicate, stack)`          | Tests a parsed `ContextPredicate` against a `KeyContext[]` stack.                               |
| `predicateDepth(predicate, stack)`             | Returns the deepest matching stack index, or `null` when unmatched.                             |
| `attachKeyListeners(...)`                      | Attaches root and capture DOM listeners with blur, hidden-tab, and pointer resets.              |
| `browserKeyEffects`                            | Browser `KeyEffects<KeyboardEvent>` implementation.                                             |
| `replayTextInput(input, event)`                | Restores unclaimed printable characters into text inputs and `EditContext` fields.              |

Types exported from `@shaulavo/hotkeys/adapter`: `KeymapBinding`, `KeymapNode`, `KeymapEdge`, `KeyEffects`, `ChordRuntime`, `ChordRuntimeOptions`, `KeymapSelection`, `KeyListenerTarget`, `KeyListeners`, and `KeyResetReason`.

## React

`@shaulavo/hotkeys/react` exports:

- Provider: `HotkeysProvider`, `useHotkeysContext`, `useDefaultHotkeysOptions`
- Registration hooks: `useHotkey`, `useHotkeys`, `useHotkeySequence`, `useHotkeySequences`, `useHotkeyRegistrations`
- Held-key and hint hooks: `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, `useHotkeyHint`
- Recorder hooks: `useHotkeyRecorder`, `useHotkeySequenceRecorder`
- Core re-exports: `formatForDisplay`, `getHotkeyRegistry`

`@shaulavo/hotkeys/react` does not re-export the rest of `@shaulavo/hotkeys`. Import core functions such as `createBrowserDispatcher`, `parseShortcut`, and `normalizeHotkey` directly from `@shaulavo/hotkeys`. Optional peer dependencies are `react` (`>=18`), `react-dom` (`>=18`), and `@tanstack/react-store` (`^0.11.1`).

`useHotkey(keys, callback, options?)` registers on the shared document registry for the component's lifetime and syncs `callback` and `options` on each render. `options` accepts `HotkeyOptions`, and `target` also accepts a React `RefObject<HTMLElement | null>`. Setting `enabled: false` keeps the registration in `useHotkeyRegistrations()` while suppressing triggers.

```tsx
useHotkey('Escape', onClose, { enabled: isOpen })
useHotkey('Mod+S', save, { target: editorRef })
```

`HotkeysProvider` accepts `defaultOptions` with keys `hotkey`, `hotkeySequence`, `hotkeyRecorder`, and `hotkeySequenceRecorder`. Because the React registration hooks use the document registry, use `createBrowserDispatcher` from `@shaulavo/hotkeys` when shortcuts depend on focus contexts.

### Option changes in React

Registration and recorder hooks replace their option configuration after each committed render. Provider defaults apply first, then hook or common options, then per-definition options in batches. Removing a prop exposes the lower-level default, and removing that default restores the core default.

Updating `target` or `platform` keeps the existing registration handle and `triggerCount`. An unattached ref removes the registration until a later render attaches the element. An omitted or `null` target uses `document`. Changing the shortcut or sequence creates a new registration. Batch rows use list position and shortcut identity, so inserting or reordering rows can replace handles.

### Failed batch updates

`useHotkeys` and `useHotkeySequences` plan all rows before changing live registrations. If planning or applying a row throws, the hook disposes every registration it owns, including retained handles and earlier handles from the same update, and rethrows the original error.

Cleanup is scoped to the failing hook rather than an atomic registry transaction. Rows apply in order, so store subscribers observe intermediate writes and an earlier `conflictBehavior: 'replace'` removal is not undone. Unrelated registrations stay active.

### Server rendering

All React hooks render on a server without `window` or `document`. Rendering creates no registry, held-key tracker, or DOM listeners. Registration hooks acquire the shared document registry in post-commit effects once refs attach, and Strict Mode replay leaves one live registration per binding.

`useHotkeyRegistrations` returns empty `hotkeys` and `sequences` arrays during server rendering and initial hydration. `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, and `useHotkeyHint` start with no held keys and sync with browser stores after commit. Recorder hooks start idle on the server. Invoke their actions from event handlers or effects. Pass an explicit `platform` to `formatForDisplay` during server rendering so server HTML matches client hydration.

# API reference

`@shaulavo/hotkeys` exposes four ESM entrypoints with explicit named exports and no wildcard re-exports. Requires Node `>=24`. The `./react` entrypoint requires optional peer dependencies `react >=19.2.0`, `react-dom >=19.2.0`, and `@tanstack/react-store ^0.11.1`.

See [src/index.ts](../src/index.ts) for the exact core export list.

## Entrypoints

| Import path                  | Runtime exports | Purpose                                                                                                                                     |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shaulavo/hotkeys`          | 28              | Parsing, formatting, matching, quick registration, `HotkeyRegistry`, focus-tree dispatchers, `explainKeymap`, recorders, `KeyStateTracker`. |
| `@shaulavo/hotkeys/react`    | 16              | `createHotkeysContext`, `HotkeysProvider`, `FocusScope`, focus hooks, registration hooks, held-key hooks, recorder hooks.                   |
| `@shaulavo/hotkeys/terminal` | 3               | `createTerminalDispatcher`, `keyInputFromTerminalKey`, `terminalKeyEffects`.                                                                |
| `@shaulavo/hotkeys/adapter`  | 9               | Low-level trie, chord runtime, predicate evaluation, and browser key listeners.                                                             |

Every entrypoint exports `"types"`, `"import"`, and `"default"` conditions, plus `./package.json`.

---

## `@shaulavo/hotkeys`

### Quick registration and registry

#### `registerHotkey(keys, callback, options?)`

Registers a single stroke or multi-stroke chord on the document registry for `options?.target` (or the global `document`). Returns a `HotkeyRegistration`.

- `keys`: `HotkeyInput` (`Hotkey | RawHotkey | readonly HotkeyStroke[] | Shortcut`).
- `callback`: `(event: KeyboardEvent, context: HotkeyCallbackContext) => void | boolean`. Returning `false` passes the key to the next matching registration.
- `HotkeyCallbackContext`: `{ readonly shortcut: string; readonly strokes: readonly ParsedHotkey[]; readonly stroke: ParsedHotkey }`. `shortcut` is the space-separated canonical chord, `strokes` holds every resolved stroke in order, and `stroke` is the completing stroke.
- `options`: `HotkeyOptions`:
  - `conflictBehavior?: 'warn' | 'error' | 'replace' | 'allow'` (default `'warn'`).
  - `enabled?: boolean` (default `true`). Disabled entries stay listed in `registrations` without firing.
  - `eventType?: 'keydown' | 'keyup'` (default `'keydown'`). Both `keydown` and `keyup` run newest-first and honor `return false` fallthrough.
  - `ignoreInputs?: boolean`. Defaults to `false` for `Control`, `Meta`, and `Escape`; defaults to `true` for bare keys and `Shift` or `Alt` bindings.
  - `platform?: Platform` (`'mac' | 'windows' | 'linux'`). Defaults to `detectPlatform()`.
  - `preventDefault?: boolean` (default `true`).
  - `stopPropagation?: boolean` (default `true`).
  - `requireReset?: boolean` (default `false`). Fires once per press until the key or a modifier is released, or until window blur or tab hide resets held state.
  - `target?: HotkeyTarget | null` (`HTMLElement | Document | Window`). Defaults to the registry's document. Must belong to that document.
  - `meta?: HotkeyMeta` (`{ name?: string; description?: string; group?: string }`, extensible via module augmentation).

#### `HotkeyRegistration`

Returned by `registerHotkey` and `registry.register`:

- `id: string`
- `isActive: boolean`
- `callback: HotkeyCallback` (settable without re-registering)
- `setOptions(options: Partial<HotkeyOptions>): void` patches options; omission keeps existing values, explicit `undefined` restores defaults.
- `replaceOptions(options: HotkeyOptions): void` replaces all configured options; omitted fields return to defaults.
- `dispose(): void` and `[Symbol.dispose](): void` remove the registration.

#### `getHotkeyRegistry(doc?)` and `createHotkeyRegistry(options?)`

- `getHotkeyRegistry(doc = document)` returns the shared `HotkeyRegistry` for `doc`, creating it on first use.
- `createHotkeyRegistry(options?)` creates an isolated `HotkeyRegistry`.
  - `options?: { readonly document?: Document; readonly timeoutMs?: number; readonly capture?: boolean }`.
- `HotkeyRegistry` members:
  - `register(keys, callback, options?) => HotkeyRegistration`
  - `registrations: Store<ReadonlyMap<string, HotkeyRegistrationView>>` holding frozen snapshots (`id`, `hotkey`, `strokes`, `options`, `target`, `triggerCount`).
  - `trigger(id: string): boolean` runs a registration's callback programmatically with a synthesized `KeyboardEvent` and full `HotkeyCallbackContext`.
  - `dispatcher: BrowserDispatcher` exposes the registry's underlying dispatcher.
  - `dispose()` and `[Symbol.dispose]()` detach listeners, clear registrations, and remove the registry from the document cache if it was the shared instance.

#### `findHotkeyConflicts(candidate, options?)`

Searches a live `HotkeyRegistry` for equivalent bindings and sequence-prefix collisions, returning `HotkeyConflict[]` (`{ type: 'hotkey' | 'sequence', registration: HotkeyRegistrationView }`).

- `options?: HotkeyConflictOptions`: `target`, `scope?: 'overlapping' | 'all'`, `eventType`, `includeDisabled`, `excludeIds`, `exclude`, `platform`, `events` (source events to detect logical and physical overlap on the recorded layout), and `registry`.

---

### Focus-aware dispatchers and keymaps

#### `createBrowserDispatcher<Commands = AnyCommands>(options?)`

Creates a DOM-backed `BrowserDispatcher<Commands>` whose focus path follows DOM containment of attached elements.

- `options?: BrowserDispatcherOptions<Commands>`:
  - `keymap?: readonly KeymapEntry<Commands>[]`
  - `root?: HTMLElement | Document` (defaults to `globalThis.document`)
  - `capture?: boolean` (default `false`; listens in capture phase when `true`)
  - `platform?: Platform`
  - `timeoutMs?: number` (default `1000`)
  - `isAvailable?: (binding: CompiledBinding<Commands>, event: KeyboardEvent) => boolean`
  - `beforeKey?: (event: KeyboardEvent) => void`
  - `acceptsTextInput?: (event: KeyboardEvent) => boolean`
  - `replay?: (input: KeyInput, event: KeyboardEvent) => void`
  - `currentFocus?: () => unknown`
  - `onPendingChange?: (pending: PendingChordLabel | null) => void`
  - `onSequence?: (event: KeymapSequenceEvent<CompiledBinding<Commands>>) => void`
  - `onCaptureChange?: () => void`
- `BrowserDispatcher<Commands>` extends `Dispatcher<KeyboardEvent, Commands>` with:
  - `attachElement(node: HostedFocusNode, element: Element): () => void`
  - `nodeForElement(element: Element): FocusNode<KeyboardEvent, Commands> | null`
  - `claimKeybinding(event: KeyboardEvent): boolean` offers an event once before DOM dispatch reaches `root` (idempotent per event).
  - `observeKeys(observer: BrowserKeyObserver): () => void` observes `beforeKey` and `reset(reason)`.
  - `asHosted(): HostedBrowserDispatcher` returns a narrow structural boundary (`createNode`, `attachElement`, `nodeForElement`, `claimKeybinding`, `observeKeys`, `contextStack`) for embedded widgets that use string command names and validate `event.args` at runtime.

#### `createDispatcher<Source = unknown, Commands = AnyCommands>(options?)`

Creates a host-agnostic `Dispatcher<Source, Commands>`.

- `createNode(options?: FocusNodeOptions<Source, Commands>): FocusNode<Source, Commands>` creates a node with optional `parent`, static `context`, dynamic `readContext`, and `commands`. Every `FocusNode` is directly assignable to `HostedFocusNode` (`{ id, parent, context }`).
- `focus(node)` and `focused()` get or set the active `FocusNode`.
- `hasNode(node)` reports whether the dispatcher owns `node` and every ancestor.
- `contextStack()` returns active `KeyContext[]` from outermost node to focused node.
- `setKeymap(entries)` strictly validates and compiles the new keymap before replacing state. If any entry is malformed, `setKeymap` throws and leaves the previous keymap, pending chord, and revision unchanged.
- `handleKey(input, source, inScope?)` dispatches one `KeyInput`, returning `true` when claimed.
- `dispatchCommand(command, args?)` and `dispatchCommandFrom(node, command, args?)` invoke command handlers along the focus path without a key event. `args` is optional when `Commands[K]` includes `undefined` (or is `void`), and required otherwise.
- `explain(input, options?)` inspects how the active keymap resolves `input` against the current (or supplied) `contextStack` without mutating state or invoking handlers.
- `pending(): PendingChordLabel | null` returns a frozen, referentially stable `{ keys: string; candidateCount: number }` snapshot (or `null`), safe for `useSyncExternalStore`. `keys` contains space-separated platform-resolved stroke strings (for example `'Control+K'` on Linux or `'Meta+K'` on macOS).
- `subscribePending(listener)` subscribes to pending-label transitions and returns an unsubscribe function. Reentrant cancellation or replacement aborts stale outer notification loops.
- `wantsCapture()`, `capturesKey(input)`, `releaseAll()`, `cancel(outcome?)`, `dispose()`, `[Symbol.dispose]()`.

#### `compileKeymap(entries, platform)` and `explainKeymap(keymap, input, options?)`

- `compileKeymap(entries, platform)` strictly validates every entry with `parseShortcut`, parses context predicates, and compiles the trie once. Throws with entry index, stroke index, and failing token on malformed entries.
- `explainKeymap(keymap, input, options?)` accepts a `HotkeyInput`, string, or `readonly KeyInput[]` stream plus `ExplainOptions` (`contextStack`, `sources`, `source`, `isAvailable`). Returns `KeymapExplanation`:
  - `active`: ordered `CompiledBinding[]` that live dispatch would try (empty when blocked by an earlier prefix).
  - `candidates`: every entry at the final node with `status` (`'matched' | 'context-mismatch' | 'unavailable' | 'availability-unknown' | 'unbound' | 'shadowed' | 'shadowed-by-prefix'`), `depth`, `rank`, and `blockedByIndex`.
  - `continuations`: reachable and prefix-shadowed longer chords below the queried node with `status` (`'pending' | 'shadowed-by-prefix' | 'unavailable' | 'availability-unknown'`) and `shadowedByIndex`.
  - `pending`: whether the queried node pends for a longer chord.
  - `blockedByPrefix`: `null` or `{ kind: 'shadowed-by-prefix', strokeIndex, winningBinding, availability }` or `{ kind: 'prefix-unavailable', strokeIndex, winningBinding: null, availability }`.
  - `mismatchedAtStrokeIndex?: number` and `ignored?: { strokeIndex, reason }`.

#### Context helpers

- `createKeyContext(init?)` constructs a `KeyContext` from `{ identifiers?, values? }`.
- `parseKeyContext(source)` parses space-separated identifiers and `key=value` pairs (for example `'Editor mode=full extension=md'`).
- `parseContextPredicate(source)` parses a `ContextPredicate` using `>`, `||`, `&&`, `==`, `!=`, `!`, and parentheses.

---

### Parsing, formatting, and matching

#### `parseShortcut(input)`

Strictly parses a string, `RawHotkey`, or stroke array into a discriminated result:

- `{ ok: true, value: Shortcut, warnings: readonly ShortcutError[] }`
- `{ ok: false, errors: readonly ShortcutError[], warnings: readonly ShortcutError[] }`

Each `ShortcutError` has `{ strokeIndex, token, message }`. `Shortcut` is a frozen branded tuple of `ValidatedStroke` objects accepted directly by registration, keymap, normalization, and display APIs.

Literal `+` rules: `'+'`, `'Mod++'`, `'Control++'`, `'Ctrl+Shift++'`, and `'Mod+Plus'` parse the key `'+'`; trailing single `'+'` after a prefix (`'Mod+'`, `'Control+Shift+'`), unknown modifiers (`'Mdo+S'`), malformed brackets (`'[KeyS'`), modifier-only strokes (`'Control+Shift'`), and empty inputs fail with `ok: false`. Unknown key names return `ok: true` with non-empty `warnings`.

#### `parseHotkey(input, platform?)`

Parses a string, `RawHotkey`, `ParsedHotkey`, `KeyInput`, or `KeyboardEventLike` into a resolved `ParsedHotkey` for `platform` (default `detectPlatform()`). For `KeyInput` and `KeyboardEventLike`, `parseHotkey` returns a logical `ParsedHotkey` (`code` omitted) so physical `[Code]` bindings stay distinct from logical keys.

#### `normalizeHotkey(input, options?)`

Normalizes a shortcut, stroke, `ParsedHotkey`, `KeyInput`, or `KeyboardEventLike` to a canonical string.

- `options?: { readonly mode?: 'symbolic' | 'resolved' | 'adaptive'; readonly platform?: Platform }`:
  - `'symbolic'` (default): preserves `Mod`, `Control`, and `Meta` as written.
  - `'resolved'`: resolves `Mod` for `platform` (`Meta` on macOS, `Control` on Windows and Linux).
  - `'adaptive'`: folds the platform's primary modifier into `Mod` when the other primary modifier is absent.

#### `formatForDisplay(hotkey, options?)`

Formats a single stroke, chord string, stroke array, `Shortcut`, or `ParsedHotkey` for UI display.

- `options?: FormatDisplayOptions`:
  - `platform?: Platform` (default `detectPlatform()`).
  - `useSymbols?: boolean | { modifiers?: boolean; keys?: boolean }` (default `true`).
  - `parts?: boolean` (default `false`; returns `string[]` when `true`).
  - `layoutMap?: { get: (code: string) => string | undefined }` for layout-aware physical labels.
  - `keyLabels?: Readonly<Record<string, string>>` overrides display labels for logical keys or physical codes without changing matching.
  - `separatorToken?: string | null` overrides the token separator (default `' '` on macOS with modifier symbols, `'+'` otherwise).

#### Matching and platform helpers

- `matchesKeyboardEvent(event, hotkey, platform?)` returns `boolean`.
- `matchesKeyInput(input, hotkey, platform?)` returns `boolean`.
- `areHotkeysEqual(left, right, platform?)` compares resolved modifiers and exact logical `key` or physical `code`. Physical codes never equal logical keys.
- `matchesHeldModifiers(hotkey, heldKeys, options?)` checks whether held modifiers reveal a shortcut hint (`options?: { platform?: Platform; exact?: boolean }`). Returns `false` when `'AltGraph'` is held.
- `detectPlatform()` returns `'mac' | 'windows' | 'linux'` (defaults to `'linux'` when `navigator` is undefined).
- `isModifierKey(key)` reports whether `key` is a modifier name or alias.
- `normalizeKeyName(key)` normalizes a DOM key name to canonical form.
- `createKeyInput(init)` and `keyInputFromKeyboardEvent(event, platform?)` build `KeyInput` values.

---

### Recorders and key state tracker

#### `KeyStateTracker` and `getKeyStateTracker()`

Singleton tracker for held keys backed by a TanStack `Store<KeyStateTrackerState>`.

- `KeyStateTrackerState`: `{ heldKeys: string[]; heldCodes: Record<string, string>; readonly activeCodes: readonly string[] }`.
- `getKeyStateTracker()` and `KeyStateTracker.getInstance()` return the shared singleton, attaching capture-phase `keydown` and `keyup` listeners on `window`, `blur` on `window`, and `visibilitychange` on `document`.
- `getHeldKeys()`, `isKeyHeld(key)` (checks `activeCodes` for bracketed `[Code]` tokens and `heldKeys` for logical keys), `isAnyKeyHeld(keys)`, `areAllKeysHeld(keys)`.
- `reset()` clears all held entries immediately.
- `dispose()` and `[Symbol.dispose]()` remove listeners, reset state, and clear the singleton reference.
- `KeyStateTracker.resetInstance()` disposes and clears the singleton for tests.

#### `HotkeyRecorder` and `HotkeySequenceRecorder`

Capture-phase shortcut recorders backed by a TanStack `Store`.

- Both accept `RecorderOptions`: `recordBy?: 'code' | 'key'` (default `'code'`), `modifierMode?: 'adaptive' | 'literal'` (default `'adaptive'`), `platform`, `detectConflicts?: boolean | HotkeyConflictOptions`, `onReject?: (rejection: RecorderRejection) => void`, plus `ignoreInputs` (default `true`), `validate`, `onRecord`, `onCancel`, `onClear`.
- `HotkeySequenceRecorder` also accepts `commitOnEnter?: boolean` (default `true`), `commitKeys?: 'enter' | 'none'` (default `'enter'`), and `idleTimeoutMs?: number`, and exposes `commit()`.
- Both expose `store`, `start()`, `stop()`, `cancel()`, `setOptions(patch)`, `replaceOptions(options)`, `dispose()`, and `[Symbol.dispose]()`.

---

## `@shaulavo/hotkeys/react`

Requires `react >=19.2.0`, `react-dom >=19.2.0`, and `@tanstack/react-store ^0.11.1`. All hooks server-render safely in Node without touching `window` or `document`.

### Provider and focus tree

#### `createHotkeysContext<Commands extends CommandMap = AnyCommands>()`

Returns a `TypedHotkeysContext<Commands>` containing `{ HotkeysProvider, FocusScope, useFocusNode, useHotkeysDispatcher, usePendingChord }` bound to one private React context.

Top-level `HotkeysProvider`, `FocusScope`, `useFocusNode`, `useHotkeysDispatcher`, and `usePendingChord` are created by calling `createHotkeysContext()` with default `AnyCommands`.

#### `HotkeysProvider`

Configures the focus dispatcher pipeline and the simple registry pipeline with three mutually exclusive ownership modes:

1. **External dispatcher:** pass `dispatcher`. Focus hooks attach to it; the provider never disposes it.
2. **Owned keymap:** pass `keymap` (and optional `root`, `platform`, `timeoutMs`, `capture`, `isAvailable`, `beforeKey`, `onSequence`). Creates a `BrowserDispatcher` on client mount, calls `setKeymap` when `keymap` changes without recreating focus nodes, and disposes it on unmount.
3. **Registry-only:** pass neither `dispatcher` nor `keymap`. Supplies optional `registry` and `defaultOptions` (`{ hotkey?, hotkeyRecorder?, hotkeySequenceRecorder? }`). `useHotkeysDispatcher()` and `usePendingChord()` return `null`; `useFocusNode` and `FocusScope` throw an explicit error.

Passing both `dispatcher` and `keymap` (or owned options alongside `dispatcher`) is rejected at the type level.

#### `useFocusNode(options)` and `<FocusScope>`

- `useFocusNode(options: UseFocusNodeOptions<Commands>)`:
  - `options`: `{ context?, commands?, parent?, target?, enabled? }`. `parent` defaults to the nearest ancestor `<FocusScope>` (or `null` at the root).
  - Returns `{ ref, node, dispatcher }`.
  - When `target` is omitted, the returned callback `ref` attaches immediately on mount or remount, including detached portals, once the dispatcher and parent are ready.
  - When `target` is supplied, the returned callback `ref` does nothing. A `RefObject` `target` resolves on the hook owner's commits, on observed DOM mutations, and before key dispatch.
  - For synchronous `dispatcher.nodeForElement` lookup across detached remounts when the hook owner does not commit, either omit `target` and attach the returned callback `ref` to the element, or use the default `<FocusScope>` wrapper.
  - Multiple hooks attached to the same `(element, parent)` on one dispatcher share a single element-attached focus node, merge their contexts on every capture, and manage their own handlers independently.
- `<FocusScope>`: wraps `useFocusNode`, renders a `<div>` accepting `ref`, `id`, `className`, and `children`, and provides its `node` to descendants. When `target` is omitted, `<FocusScope>` attaches immediately to its wrapper `<div>` through the callback `ref`. When `enabled={false}`, descendants inherit the ancestor scope.

##### Composed focus registrations

When multiple registrations share one `(element, parent)` on one dispatcher, the shared node sorts them structurally. Deeper React focus scopes come first. Within the same scope depth, each hook instance's first committed mount order breaks ties, with earlier mounts first.

Context merging and handler trials both use this structural order. On every capture, the shared node merges active contexts in that order. Identifiers combine across active registrations, and later values in the order overwrite earlier values for the same key. During dispatch, the dispatcher tries handlers for a command in that order. If a handler returns `false`, the dispatcher tries the next handler for that command. Any other return value claims the command and stops dispatch.

A registration keeps its structural position when it replaces a handler, adds a command already present on the shared node, or removes and re-adds a command. That position survives when `<Activity>` hides and reveals the subtree, or when the `ref` reattaches.

When `target` is omitted, `<FocusScope>` attaches its wrapper `<div>` before it invokes its forwarded `ref`, so synchronous `dispatcher.nodeForElement` lookup finds the focus node. A default `<FocusScope>` places its own registration one level deeper than its enclosing scope. Because deeper scopes come first, a hook on the enclosing owner that uses the forwarded `ref` with the same parent comes later. The hook's context values therefore overwrite matching keys from the scope, and the scope's handlers run before the hook's handlers.

#### `useHotkeysDispatcher()` and `usePendingChord()`

- `useHotkeysDispatcher()` returns the active `BrowserDispatcher<Commands> | null`.
- `usePendingChord()` subscribes via `useSyncExternalStore` to `dispatcher.subscribePending` and `dispatcher.pending()`. Immediately reflects an already-pending chord on mount and returns `null` during SSR or without a dispatcher.

### Registration hooks

#### `useHotkeys(definitions, commonOptions?)`

Registers a mixed list of single-stroke and sequence bindings against `props.registry ?? getHotkeyRegistry()`.

- `UseHotkeyDefinition`: `{ id?: string; callback: HotkeyCallback; options?: UseHotkeyOptions }` combined with either `{ hotkey: HotkeyStroke | Shortcut; sequence?: never }` or `{ sequence: HotkeySequence; hotkey?: never }`.
- Duplicate `id` values in one batch throw before mutating live registrations, rolling back cleanly on failure.
- Reuses an active handle only when `registry`, binding identity, and `handle.isActive` all match. Reordering with a stable `id` preserves `triggerCount`; rebinding replaces the handle; swapping the provider's `registry` moves registrations to the new registry.
- Omitting `target` or passing `target: null` binds to the active registry's own document. Passing an unresolved `RefObject` (`target.current === null`) defers registration until the ref attaches.

#### `useHotkey(hotkey, callback, options?)` and `useHotkeySequence(sequence, callback, options?)`

Single-binding wrappers over `useHotkeys` sharing `UseHotkeyOptions`, provider `registry`, and `defaultOptions.hotkey`.

#### `useHotkeyRegistrations()`

Subscribes to the active registry's `registrations` store after client commit and returns `{ hotkeys: HotkeyRegistrationView[]; sequences: HotkeyRegistrationView[] }`. Returns empty arrays during SSR.

### Held state, hints, and recorders

- `useHeldKeys(): string[]` returns currently held logical key names (empty during SSR).
- `useHeldKeyCodes(): Record<string, string>` maps held logical names to their latest physical `event.code` (empty during SSR).
- `useKeyHold(key: IndividualKey): boolean` returns whether a logical key or bracketed physical code (`'[KeyA]'`, `'[ShiftLeft]'`, `'[ShiftRight]'`) is held (`false` during SSR).
- `useHotkeyHint(hotkey: HotkeyStroke, options?: HeldModifierOptions): boolean` memoizes parsed modifiers and returns `matchesHeldModifiers(parsed, state.heldKeys, options)` (`false` during SSR).
- `useHotkeyRecorder(options)` returns `ReactHotkeyRecorder` (`isRecording`, `recordedHotkey`, `startRecording`, `stopRecording`, `cancelRecording`), merging `defaultOptions.hotkeyRecorder`.
- `useHotkeySequenceRecorder(options)` returns `ReactHotkeySequenceRecorder` (`isRecording`, `steps`, `recordedSequence`, `startRecording`, `stopRecording`, `cancelRecording`, `commitRecording`), merging `defaultOptions.hotkeySequenceRecorder`.

---

## `@shaulavo/hotkeys/terminal`

- `createTerminalDispatcher<Source extends TerminalKeyLike = TerminalKeyLike, Commands extends CommandMap = AnyCommands>(options?)` returns a `TerminalDispatcher` combining `Dispatcher<Source, Commands>` with `handleTerminalKey(event: Source): boolean`.
- `keyInputFromTerminalKey(event: TerminalKeyLike): KeyInput` maps terminal key names, maps `meta` or `option` to `alt` and `super` to `meta`, and strips implicit `shift` on printed symbols.
- `terminalKeyEffects: KeyEffects<TerminalKeyLike>` calls `preventDefault` and `stopPropagation` when present.

---

## `@shaulavo/hotkeys/adapter`

Low-level exports for custom host adapters:

- Trie and chords: `buildKeymapTrie`, `trieStep`, `createChordRuntime`, `resolveKeymapNode`.
- Predicates: `evaluatePredicate`, `predicateDepth`.
- Browser listeners: `attachKeyListeners`, `browserKeyEffects`, `replayTextInput`.
- Types: `KeymapBinding`, `KeymapNode`, `KeymapEdge`, `KeyEffects`, `ChordRuntime`, `ChordRuntimeOptions`, `KeymapSelection`, `KeyListenerTarget`, `KeyListeners`, `KeyResetReason`.

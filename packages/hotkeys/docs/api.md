# api

every export of `@fregat/hotkeys`, grouped by job. the source of truth is [`src/index.ts`](../src/index.ts). `@fregat/react-hotkeys` re-exports all of it

## register shortcuts

| export                                              | does                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `getHotkeyRegistry(doc?)`                           | the shared registry for a document                                                                                           |
| `createHotkeyRegistry(...)`                         | a registry you own                                                                                                           |
| `HotkeyRegistry.register(keys, callback, options?)` | registers a key or a chord and returns a handle with `unregister`, `setOptions`, `replaceOptions`, and a settable `callback` |
| `HotkeyRegistry.registrations`                      | a store of live registrations, for palettes and devtools                                                                     |
| `HotkeyRegistry.trigger(id)`                        | runs a callback without a key                                                                                                |
| `HotkeyRegistry.dispatcher`                         | the browser dispatcher underneath                                                                                            |
| `findHotkeyConflicts(candidate, options?)`          | lists live registrations that a new shortcut would collide with, for settings screens                                        |

registration options: `conflictBehavior` (`'warn'` by default), `enabled`, `eventType`, `ignoreInputs`, `platform`, `preventDefault`, `requireReset`, `stopPropagation`, `target`, `meta`

### update a registration

`handle.setOptions(patch)` merges the supplied fields into the current configuration. omitted fields keep their previous values. `handle.replaceOptions(options)` replaces that configuration, so omitted fields return to their defaults. explicitly setting a field to `undefined` also restores its default. `ignoreInputs` is computed from the registered shortcut when no override remains: Control/Meta combinations and Escape work inside inputs; bare keys and Shift/Alt combinations are ignored there

both setters keep the handle, registration order, callback, and trigger count. changing `platform` reparses the original strokes, so `Mod` follows the new platform while literal `Control` and `Meta` retain their meaning. the registration view and callback metadata follow the updated binding. changing `target` moves the scope within the registry's document; it does not move the document listener. a target belonging to another document is rejected before the registration changes. use `createHotkeyRegistry({ document: otherDocument })` for that document

changes to matching or event behavior cancel a pending chord. target, platform, and event-type changes also re-arm `requireReset`. metadata-only changes, callback updates, and unchanged effective options preserve pending input. changing a registration's target, event type, or resolved keys checks the resulting conflict using its current `conflictBehavior`; a rejected update leaves the old registration active. option updates to an unregistered handle do nothing

callback binding metadata is captured before publishing the trigger count. if a store subscriber changes the registration during that publication, the callback still describes the binding that matched the event; later events use the updated binding

## route keys by focus

| export                                           | does                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `createBrowserDispatcher(options)`               | a dispatcher with DOM listeners and `attachElement`     |
| `createDispatcher(options)`                      | the same engine with no DOM                             |
| `Dispatcher.createNode(options)`                 | a focus node with a context and command handlers        |
| `Dispatcher.handleKey(input, source)`            | offers a key and returns whether a binding took it      |
| `Dispatcher.dispatchCommand(command, args?)`     | runs a command along the focus path with no key         |
| `Dispatcher.setKeymap(entries)`                  | replaces the keymap                                     |
| `Dispatcher.contextStack()`                      | the contexts from the outermost node to the focused one |
| `Dispatcher.pending()`                           | the pending chord, or `null`                            |
| `BrowserDispatcher.attachElement(node, element)` | ties a node to an element                               |
| `BrowserDispatcher.claimKeybinding(event)`       | offers a forwarded event before DOM dispatch            |
| `compileKeymap(entries, platform)`               | compiles entries for lookup                             |
| `bindingsForInput(keymap, inputs, stack)`        | what a key sequence runs under a stack                  |
| `parseKeyContext`, `createKeyContext`            | build a context from shorthand or an object             |
| `parseContextPredicate`, `evaluatePredicate`     | the predicate language behind `context`                 |

dispatcher options: `keymap`, `platform`, `timeoutMs`, `replay`, `acceptsTextInput`, `isAvailable`, `currentFocus`, `onPendingChange`, `onSequence`, `onCaptureChange`. the browser dispatcher adds `root`, `capture`, and `beforeKey`

## terminals

| export                           | does                                          |
| -------------------------------- | --------------------------------------------- |
| `keyInputFromTerminalKey(event)` | turns a parsed terminal key into a `KeyInput` |
| `terminalKeyEffects`             | key effects for the terminal event shape      |
| `TerminalKeyLike`                | the accepted event shape                      |

## parse, match, and format

| export                                                     | does                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| `parseHotkey`, `normalizeHotkey`, `parseKeyInput`          | read and normalize hotkey strings         |
| `validateHotkey`, `assertValidHotkey`, `checkHotkey`       | check a hotkey string                     |
| `matchesKeyboardEvent`, `matchesKeyInput`                  | test an event against a hotkey            |
| `createHotkeyHandler`, `createMultiHotkeyHandler`          | wrap callbacks that match                 |
| `formatForDisplay(hotkey, options?)`                       | a platform label such as `⌘S` or `Ctrl+S` |
| `formatHotkey`, `formatHotkeySequence`, `formatWithLabels` | lower-level formatters                    |
| `detectPlatform()`, `resolveModifier()`                    | resolve `Mod` for a platform              |

## record shortcuts

| export                                    | does                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `HotkeyRecorder`                          | records one shortcut from input                          |
| `HotkeySequenceRecorder`                  | records a chord                                          |
| `KeyStateTracker`, `getKeyStateTracker()` | tracks held keys                                         |
| `matchesHeldModifiers(hotkey, heldKeys)`  | whether the held modifiers should reveal a shortcut hint |

both recorder classes support `setOptions(patch)` and `replaceOptions(options)`. replacement requires `onRecord` and removes omitted optional callbacks and settings without stopping an active recording or discarding its steps. changes to a sequence recorder's `idleTimeoutMs` restart its active countdown from the update; removing the timeout cancels it. callback-only updates and unchanged timeout values preserve the deadline

## low level

`createChordRuntime`, `buildKeymapTrie`, `trieStep`, `createKeymapRuntime`, `attachKeyListeners`, `keyInputFromKeyboardEvent`, `createKeyInput`. use these to build a new adapter. most apps never need them

## react

`@fregat/react-hotkeys` adds `HotkeysProvider`, `useHotkey`, `useHotkeys`, `useHotkeySequence`, `useHotkeySequences`, `useHotkeyRecorder`, `useHotkeySequenceRecorder`, `useHotkeyRegistrations`, `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, and `useHotkeyHint`. it declares `react` and `react-dom` 18 or newer as peer dependencies

`useHotkey(keys, callback, options?)` registers for the component's lifetime and re-syncs the callback and options on every render, so the callback never sees stale state. `options` is the registration options above, except `target` can also be a React ref. `enabled: false` keeps the registration listed and stops it firing

```tsx
useHotkey('Escape', onClose, { enabled: isOpen })
useHotkey('Mod+S', save, { target: editorRef })
```

`HotkeysProvider` takes `defaultOptions` with the keys `hotkey`, `hotkeySequence`, `hotkeyRecorder`, and `hotkeySequenceRecorder`. each holds defaults for the matching hook. the react hooks use the registry, so they do not have focus contexts. for those, use `registry.dispatcher` or a dispatcher from `@fregat/hotkeys`

### option changes in React

registration and recorder hooks replace their option configuration after each committed render. current provider defaults are applied first, then hook/common options, then per-definition options for batches. removing a prop reveals the current lower-level default; removing that default too restores the core behavior. for example, switching from `{ enabled: false }` to `{}` enables a shortcut unless a current provider/common default still disables it. removed recorder callbacks no longer run

target and platform updates preserve an existing registration's handle and trigger count. a ref with no attached element removes the registration until a later committed render supplies a target; an omitted or `null` target uses the document. changing the shortcut or sequence itself creates a new registration. batch rows still use their list position and shortcut as identity, so insertion/reordering can replace handles

equivalent string and raw bindings, key aliases, and letter case preserve registration identity and priority. symbolic `Mod` remains distinct from literal Control or Meta because it resolves differently across platforms

### server rendering

the React hooks can render on a server without `window` or `document`. rendering does not create the browser registry, held-key tracker, or DOM listeners. the four registration hooks acquire the shared document registry in their effects after commit, once element refs are attached. unmounting removes their registrations; Strict Mode's effect replay leaves one live registration per binding

`useHotkeyRegistrations` returns empty `hotkeys` and `sequences` arrays on the server and during initial hydration. `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, and `useHotkeyHint` also start with no keys held. after commit, these hooks subscribe to the live browser stores and catch up with existing state, including registrations created outside React. unmounting removes each hook's store subscription and preserves the shared registry and tracker for other consumers

the recorder hooks start idle on the server. call their recording actions from browser event handlers or effects. in frameworks with React Server Components, put hook-using code in a client component; that component can still render HTML on the server

platform-dependent labels need the same explicit `platform` on the server and the initial client render, for example `formatForDisplay('Mod+S', { platform: 'mac' })`. automatic platform detection can differ between Node and the browser; the empty hook snapshots do not control formatting helpers called by your component

# Performance

Run `bun bench/lookup.ts` from `packages/hotkeys`. The script prints the runtime version, operating system and architecture, iteration counts, and measured call paths.

## Methodology

The lookup benchmark uses a synthetic, editor-shaped table of 255 bindings covering modifier shortcuts on letters and navigation keys, including two-stroke chords. The keymap platform is fixed to `linux`. `bench/lookup.ts` imports `buildKeymapTrie` and `trieStep` from `@shaulavo/hotkeys/adapter` (`../src/adapter/index.js`) and `compileKeymap`, `createDispatcher`, and `keyInputFromKeyboardEvent` from `@shaulavo/hotkeys` (`../src`).

The trie builds before its lookup cases, and the dispatcher's two-level context tree builds before the dispatcher cases. Both `createDispatcher` and `setKeymap` reuse the trie produced by `compileKeymap` directly instead of compiling a second trie.

Each case warms up for 10% of its iteration count, then runs three timed rounds. Each round divides elapsed time by its call count, and the reported range is the minimum and maximum of those three averages. The timed loop includes the call and a truthiness update to a result sink. These ranges report round averages, not single-event latency percentiles.

Both dispatcher rows call `keyInputFromKeyboardEvent` before passing the resulting `KeyInput` to `dispatcher.handleKey`. The `Control+E` row matches a binding with no registered command handler, measuring context routing and the no-handler path. Registry bookkeeping, DOM listener delivery, React updates, and application command handlers require separate measurements.

## Recorded run

This snapshot was collected on 2026-10-31 with Bun 1.4.4 on `linux/x64` against commit [be0d8f1](https://github.com/ShaulLavo/hotkeys/tree/be0d8f13e98705a85e682354c60db06c1ad66e55) using the workloads above. The optional Editor comparator was unavailable. Hardware, host load, runtime optimization, and garbage collection affect timings. These numbers describe that single run.

| Measured call path                                                                    | Iterations per timed round | Time per call  |
| ------------------------------------------------------------------------------------- | -------------------------- | -------------- |
| `keyInputFromKeyboardEvent` + `trieStep`, plain `q` (unbound)                         | 2,000,000                  | 0.264–0.295 µs |
| `keyInputFromKeyboardEvent` + `trieStep`, `Control+E` (bound edge)                    | 2,000,000                  | 0.189–0.207 µs |
| `trieStep` on a prebuilt `KeyInput`, plain `q` (unbound)                              | 2,000,000                  | 0.026–0.034 µs |
| `keyInputFromKeyboardEvent` + `dispatcher.handleKey`, plain `q` (unbound)             | 1,000,000                  | 0.323–0.356 µs |
| `keyInputFromKeyboardEvent` + `dispatcher.handleKey`, `Control+E` (bound, no handler) | 200,000                    | 1.009–1.198 µs |

For construction, input entries are generated before timing `compileKeymap`. The per-binding column divides the fastest round's per-call time by the entry count.

| Keymap entries | Iterations per timed round | `compileKeymap` time per call | Fastest round per binding |
| -------------- | -------------------------- | ----------------------------- | ------------------------- |
| 255            | 200                        | 644.390–1250.075 µs           | 2.527 µs                  |
| 2,550          | 200                        | 10513.844–14723.664 µs        | 4.123 µs                  |
| 25,500         | 20                         | 96819.882–141817.009 µs       | 3.797 µs                  |

These three sizes show the cost of compiling the generated tables. Larger tables reuse shortcut patterns, so entry counts include repeated shortcuts. These samples do not establish asymptotic complexity or compare compilation with registry construction.

## Optional Editor comparison

To enable the optional Editor comparator, link a compatible Editor core checkout at `packages/editor-core` from the repository root so `packages/editor-core/src/keymap/trie.ts` exists. If that file cannot be imported, the benchmark skips the comparison. The checkout must export compatible `buildKeymapTrie` and `trieStep` functions. Record its commit alongside any comparison results.

The Editor rows pass a keyboard-event-shaped object directly to `trieStep`, while the hotkeys rows call `keyInputFromKeyboardEvent` before `trieStep`. Account for that difference when comparing timings. The script does not include a linear-scan benchmark.

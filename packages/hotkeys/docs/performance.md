# performance

run `bun bench/lookup.ts` from `packages/hotkeys`. the script prints the runtime version, operating system and architecture, iteration counts, and measured call paths.

## methodology

the lookup cases use a synthetic, editor-shaped table of 255 bindings: modifier shortcuts on letters and navigation keys, including two-stroke sequences. the keymap platform is fixed to `linux`. the trie is built before its lookup cases, and the dispatcher's two-level context tree is prepared before the dispatcher cases.

each case first warms up for 10% of its iteration count, then runs three timed rounds. each round's elapsed time is divided by its call count; the reported range is the minimum and maximum of those three averages. the timed loop includes the call and a truthiness-based update to a result sink. the range describes round averages, rather than individual-event latency or a percentile.

both dispatcher rows include `keyInputFromKeyboardEvent` before passing the resulting `KeyInput` to `dispatcher.handleKey`. the `Control+E` row matches a binding, but no command handler is registered: it measures context routing and the no-handler path. these cases cover trie lookup and dispatcher routing. registry registration and trigger bookkeeping, DOM listener delivery, React updates, and application command handlers need separate measurements.

## recorded run

this snapshot was collected on 2026-10-31 with Bun 1.4.4 on `linux/x64`, using the core code at [be0d8f1](https://github.com/ShaulLavo/hotkeys/tree/be0d8f13e98705a85e682354c60db06c1ad66e55) and the workloads described above. the optional Editor comparator was unavailable. hardware, host load, runtime optimization, and garbage collection affect timings; these ranges describe this single invocation of the benchmark.

| measured call path                                                                    | iterations per timed round | time per call  |
| ------------------------------------------------------------------------------------- | -------------------------- | -------------- |
| `keyInputFromKeyboardEvent` + `trieStep`, plain `q` (unbound)                         | 2,000,000                  | 0.264–0.295 µs |
| `keyInputFromKeyboardEvent` + `trieStep`, `Control+E` (bound edge)                    | 2,000,000                  | 0.189–0.207 µs |
| `trieStep` on a prebuilt `KeyInput`, plain `q` (unbound)                              | 2,000,000                  | 0.026–0.034 µs |
| `keyInputFromKeyboardEvent` + `dispatcher.handleKey`, plain `q` (unbound)             | 1,000,000                  | 0.323–0.356 µs |
| `keyInputFromKeyboardEvent` + `dispatcher.handleKey`, `Control+E` (bound, no handler) | 200,000                    | 1.009–1.198 µs |

for construction, input entries are generated before timing `compileKeymap`. the per-binding column divides the fastest round's per-call time by the entry count.

| keymap entries | iterations per timed round | `compileKeymap` time per call | fastest round per binding |
| -------------- | -------------------------- | ----------------------------- | ------------------------- |
| 255            | 200                        | 644.390–1250.075 µs           | 2.527 µs                  |
| 2,550          | 200                        | 10513.844–14723.664 µs        | 4.123 µs                  |
| 25,500         | 20                         | 96819.882–141817.009 µs       | 3.797 µs                  |

these three sizes show the cost of compiling the generated tables. larger tables reuse shortcut patterns, so entry counts include repeated shortcuts. the samples alone do not establish asymptotic complexity or compare compilation with registry construction.

## optional Editor comparison

link a compatible Editor core checkout at the repository root's `packages/editor-core`, so that `packages/editor-core/src/keymap/trie.ts` exists. the benchmark loads that module and reports the comparison as skipped if it cannot be imported. the checkout must expose compatible `buildKeymapTrie` and `trieStep` functions; record its revision alongside any comparison results.

the Editor rows call `trieStep` with a keyboard-event-shaped object directly. the corresponding hotkeys rows call `keyInputFromKeyboardEvent` and then `trieStep`. compare the specific measured paths and their semantics when interpreting results. the script contains no linear-scan benchmark.

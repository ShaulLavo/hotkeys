# Performance

`@shaulavo/hotkeys` keeps per-keystroke work linear in the stroke count of a chord and avoids repeated trie compilation and unnecessary React renders.

## Architecture choices

- **Single trie compilation:** `compileKeymap` builds the stroke trie once and stores it on `keymap.root`. `createDispatcher` and `dispatcher.setKeymap` pass `keymap.root` directly into `createChordRuntime` instead of building a second trie.
- **Direct edge lookup:** each trie node maps key strings to a 16-slot array indexed by the 4-bit modifier mask (`alt | ctrl | meta | shift`), so `trieStep` resolves unbound keys in one map lookup and bound edges without scanning the keymap table.
- **Lazy registry keymap sync:** `HotkeyRegistry` marks its internal keymap dirty on register, dispose, or behavioral option changes and recompiles once on the next key event (`beforeKey`), so batch mounts compile a single trie instead of rebuilding on every registration.
- **Metadata-only option updates:** `handle.setOptions({ meta })` updates the frozen `HotkeyRegistrationView` without invalidating the compiled keymap or cancelling pending chords when behavior did not change.
- **React hook allocations:** `useHotkeyHint` memoizes `parseHotkey(hotkey, platform)` across held-key updates, and `useHotkeyRegistrations` partitions single-stroke and sequence views in one pass.

## Benchmarks

Two benchmark scripts live in `packages/hotkeys/bench/`:

- `bench/lookup.ts`: measures `keyInputFromKeyboardEvent`, `trieStep`, `dispatcher.handleKey`, and `compileKeymap` across 255, 2,550, and 25,500 bindings.
- `bench/registry.ts`: measures `HotkeyRegistry` lifecycle (`register`, `firstKey`, metadata `setOptions`, `keydown` + `keyup` dispatch, `dispose`, and store publications) at 100, 500, and 1,000 registrations, both unsubscribed and subscribed.

Run both benchmarks from `packages/hotkeys`:

```bash
cd packages/hotkeys
bun bench/lookup.ts
bun bench/registry.ts
```

## Reference measurements

Measured on `Bun 1.4.4` (`linux/x64`) on 2026-11-28.

### Lookup and keymap compilation (`bun bench/lookup.ts`)

Warmup: 10% of iterations. Timed rounds: 3. Range: min to max per call.

| Operation                                                                           | Per-call range                                           | Iterations per round |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| `keyInputFromKeyboardEvent + trieStep`, plain `q` (unbound)                         | 0.102 to 0.119 µs                                        | 2,000,000            |
| `keyInputFromKeyboardEvent + trieStep`, `Control+E` (bound edge)                    | 0.052 to 0.065 µs                                        | 2,000,000            |
| `trieStep` on prebuilt `KeyInput`, plain `q` (unbound)                              | 0.048 to 0.070 µs                                        | 2,000,000            |
| `keyInputFromKeyboardEvent + dispatcher.handleKey`, plain `q` (unbound)             | 0.172 to 0.188 µs                                        | 1,000,000            |
| `keyInputFromKeyboardEvent + dispatcher.handleKey`, `Control+E` (bound, no handler) | 0.553 to 0.604 µs                                        | 200,000              |
| `compileKeymap` (255 bindings)                                                      | 620.820 to 634.956 µs (2.435 µs/binding fastest)         | 200                  |
| `compileKeymap` (2,550 bindings)                                                    | 8,492.528 to 10,328.257 µs (3.330 µs/binding fastest)    | 200                  |
| `compileKeymap` (25,500 bindings)                                                   | 110,863.345 to 149,186.268 µs (4.348 µs/binding fastest) | 20                   |

### Registry lifecycle (`bun bench/registry.ts`)

Median of 5 rounds in `happy-dom`, in milliseconds:

| Registrations | Subscribed | `register` | `firstKey` | `metadata` | `keydownAndKeyup` | `remove`  | Publications |
| ------------- | ---------- | ---------- | ---------- | ---------- | ----------------- | --------- | ------------ |
| 100           | `false`    | 1.329 ms   | 0.568 ms   | 1.384 ms   | 2.002 ms          | 0.502 ms  | 0            |
| 100           | `true`     | 1.290 ms   | 0.486 ms   | 1.093 ms   | 2.378 ms          | 0.410 ms  | 401          |
| 500           | `false`    | 9.603 ms   | 2.090 ms   | 12.991 ms  | 10.046 ms         | 7.541 ms  | 0            |
| 500           | `true`     | 6.251 ms   | 1.429 ms   | 9.959 ms   | 10.168 ms         | 7.530 ms  | 2,001        |
| 1,000         | `false`    | 24.864 ms  | 3.695 ms   | 35.566 ms  | 17.690 ms         | 20.087 ms | 0            |
| 1,000         | `true`     | 28.003 ms  | 3.453 ms   | 34.955 ms  | 14.189 ms         | 13.527 ms | 4,001        |

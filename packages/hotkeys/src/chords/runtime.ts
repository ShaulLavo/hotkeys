import { isModifierKey } from '../parse.js'
import { isPrintableKey } from '../_keyboard-event.js'
import { buildKeymapTrie, trieStep } from './trie.js'
import type { KeyInput } from '../key-input.js'
import type { KeymapEdge, KeymapNode } from './trie.js'
import type {
  ChordOutcome,
  KeymapBinding,
  KeymapPlatform,
  KeymapSequenceEvent,
  PendingChordLabel,
} from './types.js'

/** How the host applies the runtime's decisions to its own event. */
export type KeyEffects<Source> = {
  readonly preventDefault: (source: Source) => void
  readonly stopPropagation: (source: Source) => void
  /** Keeps the key from every later listener and from default input handling. */
  readonly swallow: (source: Source) => void
}
export type ChordRuntimeOptions<Payload, Context, Source> = {
  readonly bindings: readonly KeymapBinding<Payload>[]
  readonly platform: KeymapPlatform
  readonly enabled?: boolean
  readonly effects: KeyEffects<Source>
  readonly captureContext: (source: Source) => Context
  /** Filters candidates for the default {@link ChordRuntimeOptions.select}. */
  readonly isAvailable?: (
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
  ) => boolean
  /**
   * Chooses what a trie node offers for this key: the bindings to run, in order, and how many
   * longer bindings keep a chord pending. Defaults to available candidates in table order.
   */
  readonly select?: (
    node: KeymapNode<Payload>,
    context: Context,
    source: Source,
  ) => KeymapSelection<Payload>
  /**
   * Receives the original triggering input, including when a buffered prefix runs later.
   * Returns false to decline; the next available candidate then gets the key.
   * Nested handleKey calls run synchronously. A completed chord's pending record is detached
   * before this callback, so nested input can start its own chord without outer cleanup.
   */
  readonly dispatch: (
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
    input: KeyInput,
  ) => boolean
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<Payload>) => void
  /** Called whenever {@link ChordRuntime.wantsCapture} may have changed. */
  readonly onCaptureChange?: () => void
  /**
   * Receives each unclaimed buffered key in order when a chord mismatches, times out, or its
   * completion declines. The current unclaimed event passes through normally; only previously
   * buffered keys need replay (a terminal re-encodes them for the shell).
   * Cancellation, replacement, disabling, disposal, or a focus change stops remaining replay.
   */
  readonly replay?: (input: KeyInput, source: Source) => void
  /**
   * True when the focused target takes typed text. A printable prefix then pends with a timeout,
   * and `replay` receives the character when no chord follows.
   */
  readonly acceptsTextInput?: (source: Source) => boolean
  /** Identifies the focus; a pending chord ends without replay when it changes. */
  readonly currentFocus?: () => unknown
  /** How long a prefix that is itself bound waits for its continuation. Other prefixes wait until the next key. */
  readonly timeoutMs?: number
}
export type ChordRuntime<Payload, Source> = {
  /**
   * Offers one key to the runtime; true means the runtime owns it. `inScope` says whether an
   * idle runtime may start matching this key (a pending chord or a held claimed key always may).
   * May be called synchronously from handlers and notifications; each call keeps its own input.
   */
  readonly handleKey: (input: KeyInput, source: Source, inScope?: boolean) => boolean
  /** True while a chord is pending or a claimed key is held, so a host listens ahead of others. */
  readonly wantsCapture: () => boolean
  /** True when a capturing host listener should offer this key before anyone else. */
  readonly capturesKey: (input: KeyInput) => boolean
  /** Forgets held keys, for blur and hidden tabs where their release never arrives. */
  readonly releaseAll: () => void
  readonly updateBindings: (bindings: readonly KeymapBinding<Payload>[]) => void
  readonly setEnabled: (enabled: boolean) => void
  /** Cancels pending state and invalidates active dispatch/recovery, including detached buffers. */
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
  readonly pending: () => PendingChordLabel | null
}

export type KeymapSelection<Payload> = {
  readonly bindings: readonly KeymapBinding<Payload>[]
  /** Count of longer bindings still reachable; nonzero keeps the chord pending. */
  readonly pending: number
}
type Ownership = 'binding' | 'chord'
type DispatchResult<Payload> =
  | { readonly kind: 'claimed'; readonly binding: KeymapBinding<Payload> }
  | { readonly kind: 'declined' | 'unavailable' | 'handled' }
  | { readonly kind: 'cancelled'; readonly outcome: ChordOutcome }
type Buffered<Source> = { readonly input: KeyInput; readonly source: Source }
type Replayed<Payload, Source> = {
  readonly claimed: KeymapBinding<Payload> | null
  readonly rest: readonly Buffered<Source>[]
}
/** Buffered keys plus a new key that match again from the root after a mismatch. */
type Sequence<Payload, Context, Source> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly buffer: readonly Buffered<Source>[]
  readonly context: Context
  readonly selection: KeymapSelection<Payload>
}
type Pending<Payload, Source> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly count: number
  readonly buffer: readonly Buffered<Source>[]
  readonly started: number
  readonly focus: unknown
  readonly timed: boolean
}
type Operation<Payload, Source> = {
  readonly parent: Operation<Payload, Source> | null
  readonly key: string | null
  sequence: Pending<Payload, Source> | null
  pendingRevision: number
  cancellation: ChordOutcome | null
  released: boolean
}
const DEFAULT_TIMEOUT_MS = 1_000

/** The chord state machine over {@link KeyInput}. Hosts adapt their events and apply {@link KeyEffects}. */
export function createChordRuntime<Payload, Context, Source>(
  options: ChordRuntimeOptions<Payload, Context, Source>,
): ChordRuntime<Payload, Source> {
  const { effects, platform } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let trie = buildKeymapTrie(options.bindings, platform)
  let enabled = options.enabled !== false
  let disposed = false
  let activeOperation: Operation<Payload, Source> | null = null
  let pending: Pending<Payload, Source> | null = null
  let pendingRevision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const claimedKeys = new Map<string, Ownership>()
  const isAvailable = options.isAvailable ?? (() => true)
  const select = options.select ?? selectAvailable

  function operate<Result>(run: () => Result, key: string | null = null): Result {
    const parent = activeOperation
    activeOperation = {
      parent,
      key,
      sequence: pending,
      pendingRevision,
      cancellation: null,
      released: false,
    }
    try {
      return run()
    } finally {
      activeOperation = parent
    }
  }
  function canContinue(): boolean {
    const operation = activeOperation
    if (disposed || operation?.cancellation) return false
    const moved = operation?.sequence && focusMoved(operation.sequence)
    // The focus reader can itself trigger teardown.
    return !moved && !disposed && !operation?.cancellation
  }
  function ownsPending(): boolean {
    return canContinue() && activeOperation?.pendingRevision === pendingRevision
  }
  function changedPending(): number {
    pendingRevision += 1
    if (activeOperation) activeOperation.pendingRevision = pendingRevision
    return pendingRevision
  }

  function selectAvailable(
    node: KeymapNode<Payload>,
    context: Context,
    source: Source,
  ): KeymapSelection<Payload> {
    const bindings = node.candidates.filter((binding) => isAvailable(binding, context, source))
    let count = 0
    for (const binding of node.descendants) {
      if (isAvailable(binding, context, source)) count += 1
    }
    return { bindings, pending: count }
  }

  function hasChordOwnership() {
    for (const owner of claimedKeys.values()) {
      if (owner === 'chord') return true
    }
    return false
  }
  function wantsCapture() {
    if (disposed) return false
    return pending !== null || hasChordOwnership() || (!enabled && claimedKeys.size > 0)
  }
  function syncCapture() {
    options.onCaptureChange?.()
  }
  function cancel(outcome: ChordOutcome = 'superseded') {
    for (let operation = activeOperation; operation; operation = operation.parent)
      operation.cancellation = outcome
    if (!pending) return
    const ended = endPending()
    if (!disposed || outcome === 'disposed') report(ended, outcome, null)
  }
  function endPending(): Pending<Payload, Source> {
    const ended = pending!
    pending = null
    clearTimeout(timer)
    const revision = changedPending()
    syncCapture()
    if (revision === pendingRevision) options.onPendingChange?.(null)
    return ended
  }
  function report(
    ended: Pending<Payload, Source>,
    outcome: ChordOutcome,
    binding: KeymapBinding<Payload> | null,
  ) {
    options.onSequence?.({
      outcome,
      keys: ended.keys,
      candidateCount: ended.count,
      strokeCount: binding?.chord.length ?? ended.buffer.length,
      elapsedMs: Date.now() - ended.started,
      binding,
    })
  }
  function reportOperation(
    ended: Pending<Payload, Source>,
    outcome: ChordOutcome,
    binding: KeymapBinding<Payload> | null,
  ) {
    if (disposed) return
    // A successful completion keeps its claim even if its handler also cancels or moves focus.
    if (outcome === 'completed') return report(ended, outcome, binding)
    const moved = focusMoved(ended)
    const cancellation = activeOperation?.cancellation ?? (moved ? 'superseded' : null)
    if (!disposed) report(ended, cancellation ?? outcome, cancellation ? null : binding)
  }
  function pendingFrom(
    edge: KeymapEdge<Payload>,
    entry: Buffered<Source>,
    count: number,
    bound: boolean,
  ): Pending<Payload, Source> {
    const previous = pending
    return {
      node: edge.node,
      keys: previous ? `${previous.keys} ${edge.keys}` : edge.keys,
      count,
      buffer: (previous?.buffer ?? []).concat([entry]),
      started: previous?.started ?? Date.now(),
      focus: previous ? previous.focus : options.currentFocus?.(),
      // Zed times out a bound prefix or typed text; once running, the timeout restarts per stroke.
      timed: bound || previous?.timed === true || typesText(entry),
    }
  }
  function claimPending(
    next: Pending<Payload, Source>,
    replayOnReplacement: readonly Buffered<Source>[],
  ): Ownership | null {
    if (!ownsPending()) return null
    effects.swallow(next.buffer.at(-1)!.source)
    if (ownsPending()) setPending(next)
    else replayKeys(replayOnReplacement)
    return 'chord'
  }
  function setPending(next: Pending<Payload, Source>) {
    pending = next
    clearTimeout(timer)
    if (next.timed) timer = setTimeout(timeout, timeoutMs)
    const revision = changedPending()
    syncCapture()
    if (revision === pendingRevision)
      options.onPendingChange?.({ keys: next.keys, candidateCount: next.count })
  }
  function typesText({ input, source }: Buffered<Source>) {
    const { ctrl, meta } = input.modifiers
    if (ctrl || meta || !(isPrintableKey(input.key) || input.key === 'Space')) return false
    return options.acceptsTextInput?.(source) === true
  }
  function timeout() {
    if (!pending) return
    operate(expirePending)
  }
  function expirePending() {
    const sequence = pending!
    // Zed flushes only while focus is where the chord started; elsewhere the prefix is dropped.
    if (focusMoved(sequence)) {
      if (pending === sequence) reportOperation(endPending(), 'superseded', null)
      return
    }
    if (!ownsPending()) return
    const ended = endPending()
    reportOperation(ended, 'timeout', flush(ended.buffer))
  }
  function focusMoved(sequence: Pending<Payload, Source>) {
    return options.currentFocus !== undefined && options.currentFocus() !== sequence.focus
  }
  /** Zed's `flush_dispatch`: replays prefixes until no buffered key is left. Returns the first claim. */
  function flush(buffer: readonly Buffered<Source>[]): KeymapBinding<Payload> | null {
    let claimed: KeymapBinding<Payload> | null = null
    let rest = buffer
    while (rest.length && canContinue()) {
      const step = replayPrefix(rest)
      claimed ??= step.claimed
      rest = step.rest
    }
    return claimed
  }
  /**
   * Zed's `replay_prefix`: runs the longest buffered prefix that has an available binding, or
   * hands the first key to the host's `replay`. If the bound prefix declines, replays that whole
   * prefix once without retrying shorter bindings inside it. Returns the keys after it.
   */
  function replayPrefix(buffer: readonly Buffered<Source>[]): Replayed<Payload, Source> {
    const first = buffer[0]!
    const context = options.captureContext(first.source)
    const end = longestBoundPrefix(buffer, context)
    if (!end) {
      replayKeys(buffer.slice(0, 1))
      return { claimed: null, rest: buffer.slice(1) }
    }
    const last = buffer[end.index]!
    const result = execute(end.bindings, context, last.source, last.input, true)
    if (result.kind === 'declined' || result.kind === 'unavailable')
      replayKeys(buffer.slice(0, end.index + 1))
    const claimed = result.kind === 'claimed' ? result.binding : null
    return { claimed, rest: buffer.slice(end.index + 1) }
  }
  function replayKeys(buffer: readonly Buffered<Source>[]) {
    for (const { input, source } of buffer) {
      if (!canContinue()) break
      options.replay?.(input, source)
    }
  }
  function longestBoundPrefix(
    buffer: readonly Buffered<Source>[],
    context: Context,
  ): { index: number; bindings: readonly KeymapBinding<Payload>[] } | null {
    let node = trie
    let found: { index: number; bindings: readonly KeymapBinding<Payload>[] } | null = null
    for (let index = 0; index < buffer.length && canContinue(); index += 1) {
      const entry = buffer[index]!
      const edge = trieStep(node, entry.input)
      if (!edge) break
      node = edge.node
      const { bindings } = select(node, context, entry.source)
      if (bindings.length) found = { index, bindings }
    }
    return found
  }
  function execute(
    bindings: readonly KeymapBinding<Payload>[],
    context: Context,
    source: Source,
    input: KeyInput,
    fromChord: boolean,
  ): DispatchResult<Payload> {
    if (!canContinue()) return { kind: 'unavailable' }
    let handled = false
    for (const binding of bindings) {
      const result = dispatchBinding(binding, context, source, input)
      const claimed = result.kind === 'claimed'
      if (binding.preventDefault === true || (claimed && binding.preventDefault !== false))
        effects.preventDefault(source)
      if (binding.stopPropagation === true || (claimed && binding.stopPropagation !== false))
        effects.stopPropagation(source)
      if (binding.preventDefault === true || binding.stopPropagation === true) handled = true
      if (result.kind === 'cancelled' && !fromChord)
        return { kind: handled ? 'handled' : 'declined' }
      if (result.kind !== 'declined') return result
      if (!canContinue()) break
    }
    if (!bindings.length) return { kind: 'unavailable' }
    return { kind: handled ? 'handled' : 'declined' }
  }
  function dispatchBinding(
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
    input: KeyInput,
  ): DispatchResult<Payload> {
    const operation = activeOperation!
    const claimed = options.dispatch(binding, context, source, input)
    if (claimed) return { kind: 'claimed', binding }
    if (operation.cancellation && operation.cancellation !== 'disposed')
      return { kind: 'cancelled', outcome: operation.cancellation }
    return { kind: 'declined' }
  }
  function ownChord(source: Source): Ownership {
    effects.swallow(source)
    return 'chord'
  }
  function match(input: KeyInput, source: Source): Ownership | null {
    if (!enabled || input.composing) return null
    if (isModifierKey(input.key)) return pending ? ownChord(source) : null
    if (pending && input.repeat) return ownChord(source)
    const sequence = pending
    if (sequence && focusMoved(sequence)) {
      if (pending !== sequence) return null
      const ended = endPending()
      activeOperation!.sequence = null
      reportOperation(ended, 'superseded', null)
    }
    if (!ownsPending()) return null
    if (pending) {
      const continued = continueChord(input, source)
      if (continued !== undefined) return continued
    }
    const edge = trieStep(trie, input)
    if (!edge) return null
    const context = options.captureContext(source)
    const selection = select(edge.node, context, source)
    if (!ownsPending()) return null
    return resolve(edge, input, source, context, selection, false)
  }
  /** Returns undefined when the key matches from the root after the chord replayed. */
  function continueChord(input: KeyInput, source: Source): Ownership | null | undefined {
    const edge = trieStep(pending!.node, input)
    if (edge) {
      const context = options.captureContext(source)
      const selection = select(edge.node, context, source)
      if (!ownsPending()) return null
      if (selection.bindings.length || selection.pending)
        return resolve(edge, input, source, context, selection, true)
    }
    const ended = endPending()
    const entry = { input, source }
    let claimed: KeymapBinding<Payload> | null = null
    let rest = ended.buffer
    let sequence: Sequence<Payload, Context, Source> | null = null
    // Zed's `dispatch_key`: replay a prefix, then match the leftover keys and this one again.
    while (rest.length && !sequence && canContinue()) {
      const step = replayPrefix(rest)
      claimed ??= step.claimed
      rest = step.rest
      if (rest.length && ownsPending()) sequence = lookupSequence(rest.concat([entry]))
    }
    reportOperation(ended, 'unmatched', claimed)
    if (!ownsPending()) {
      if (sequence) replayKeys(sequence.buffer.slice(0, -1))
      return null
    }
    return sequence ? resumeSequence(sequence) : undefined
  }
  function lookupSequence(
    buffer: readonly Buffered<Source>[],
  ): Sequence<Payload, Context, Source> | null {
    let node = trie
    const keys: string[] = []
    for (const { input } of buffer) {
      const edge = trieStep(node, input)
      if (!edge) return null
      node = edge.node
      keys.push(edge.keys)
    }
    const { source } = buffer.at(-1)!
    const context = options.captureContext(source)
    const selection = select(node, context, source)
    if (!ownsPending()) return null
    if (!selection.pending && !selection.bindings.length) return null
    return { node, keys: keys.join(' '), buffer, context, selection }
  }
  function resumeSequence(sequence: Sequence<Payload, Context, Source>): Ownership | null {
    const { buffer, selection } = sequence
    const { input, source } = buffer.at(-1)!
    if (selection.pending) {
      const next = {
        node: sequence.node,
        keys: sequence.keys,
        count: selection.pending,
        buffer,
        started: Date.now(),
        focus: options.currentFocus?.(),
        timed: selection.bindings.length > 0 || buffer.some(typesText),
      }
      const ownership = claimPending(next, buffer)
      if (!ownership) replayKeys(buffer.slice(0, -1))
      return ownership
    }
    const result = execute(selection.bindings, sequence.context, source, input, true)
    if (result.kind === 'claimed' || result.kind === 'handled' || result.kind === 'cancelled') {
      effects.swallow(source)
      return 'chord'
    }
    // Nothing took the new chord: its earlier keys go back to the host, the new key passes on.
    replayKeys(buffer.slice(0, -1))
    return null
  }
  function resolve(
    edge: KeymapEdge<Payload>,
    input: KeyInput,
    source: Source,
    context: Context,
    selection: KeymapSelection<Payload>,
    fromChord: boolean,
  ): Ownership | null {
    if (selection.pending) {
      if (input.repeat) return null
      const entry = { input, source }
      const next = pendingFrom(edge, entry, selection.pending, selection.bindings.length > 0)
      // Nested input may have already resolved the previous pending buffer; only this key is ours.
      return claimPending(next, [entry])
    }
    // The completing operation owns this record before notifications or handlers can reenter.
    const ended = fromChord ? endPending() : null
    const result = execute(selection.bindings, context, source, input, fromChord)
    const owned =
      result.kind === 'claimed' || result.kind === 'handled' || result.kind === 'cancelled'
    if (fromChord && owned) effects.swallow(source)
    if (ended) {
      if (result.kind === 'claimed') reportOperation(ended, 'completed', result.binding)
      else {
        if (!owned) replayKeys(ended.buffer)
        reportOperation(ended, result.kind === 'cancelled' ? result.outcome : 'unavailable', null)
      }
    }
    if (!owned) return null
    return fromChord ? 'chord' : 'binding'
  }
  function handleKey(input: KeyInput, source: Source, inScope = true): boolean {
    if (disposed) return false
    return operate(() => handleInput(input, source, inScope), input.code || input.key)
  }
  function handleInput(input: KeyInput, source: Source, inScope: boolean): boolean {
    const operation = activeOperation!
    const code = input.code || input.key
    if (input.type === 'keyup') return release(source, code)
    if (!input.repeat) claimedKeys.delete(code)
    const previous = claimedKeys.get(code)
    if (input.repeat && previous && (previous === 'chord' || !enabled) && !input.composing) {
      effects.swallow(source)
      return true
    }
    if (!pending && !inScope) return false
    let ownership = match(input, source)
    if (!ownership && input.repeat && previous && !input.composing && !disposed)
      ownership = ownChord(source)
    if (ownership && !disposed && !operation.released) claimedKeys.set(code, ownership)
    syncCapture()
    return ownership !== null
  }
  function release(source: Source, code: string) {
    for (let operation = activeOperation; operation; operation = operation.parent) {
      if (operation.key === code) operation.released = true
    }
    const claimed = claimedKeys.delete(code)
    if (claimed) effects.swallow(source)
    syncCapture()
    return claimed
  }
  function capturesKey(input: KeyInput) {
    if (pending) return true
    const owner = claimedKeys.get(input.code || input.key)
    return input.repeat && owner !== undefined && (owner === 'chord' || !enabled)
  }
  function releaseAll() {
    for (let operation = activeOperation; operation; operation = operation.parent)
      operation.released = true
    claimedKeys.clear()
    syncCapture()
  }
  function updateBindings(bindings: readonly KeymapBinding<Payload>[]) {
    trie = buildKeymapTrie(bindings, platform)
    cancel('superseded')
  }
  function setEnabled(next: boolean) {
    enabled = next
    if (!enabled) cancel('disabled')
    syncCapture()
  }
  function dispose() {
    if (disposed) return
    disposed = true
    claimedKeys.clear()
    cancel('disposed')
    syncCapture()
  }
  function currentPending(): PendingChordLabel | null {
    return pending && { keys: pending.keys, candidateCount: pending.count }
  }
  return {
    handleKey,
    wantsCapture,
    capturesKey,
    releaseAll,
    updateBindings,
    setEnabled,
    cancel,
    dispose,
    pending: currentPending,
  }
}

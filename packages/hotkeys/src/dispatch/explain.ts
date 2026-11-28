import { selectTrieStep } from '../chords/runtime.js'
import { predicateDepth } from '../context/predicate.js'
import { createKeyInput } from '../key-input.js'
import { isModifierKey, parseHotkey } from '../parse.js'
import { requireShortcut } from '../shortcut.js'
import { effectiveBindings, resolveKeymapNode } from './keymap.js'
import type { KeymapSelection } from '../chords/runtime.js'
import type { KeymapNode } from '../chords/trie.js'
import type { KeyContext } from '../context/key-context.js'
import type { HotkeyInput } from '../hotkey.types.js'
import type { KeyInput } from '../key-input.js'
import type { AnyCommands, CommandMap } from './commands.js'
import type { CompiledBinding, CompiledKeymap } from './keymap.js'

export type ExplainOptions<Source = unknown, Commands extends CommandMap = AnyCommands> = {
  readonly contextStack?: readonly KeyContext[]
  readonly sources?: readonly (Source | undefined)[]
  readonly source?: Source
  readonly isAvailable?: (binding: CompiledBinding<Commands>, source: Source) => boolean
}

export type CandidateStatus =
  | 'matched'
  | 'context-mismatch'
  | 'unavailable'
  | 'availability-unknown'
  | 'unbound'
  | 'shadowed'
  | 'shadowed-by-prefix'

export type ExplainedCandidate<Commands extends CommandMap = AnyCommands> = {
  readonly binding: CompiledBinding<Commands>
  readonly status: CandidateStatus
  readonly depth: number | null
  readonly rank: number
  readonly blockedByIndex: number | null
}

export type ExplainedContinuation<Commands extends CommandMap = AnyCommands> = {
  readonly binding: CompiledBinding<Commands>
  readonly status: 'pending' | 'shadowed-by-prefix' | 'unavailable' | 'availability-unknown'
  readonly shadowedByIndex: number | null
}

export type BlockedPrefix<Commands extends CommandMap = AnyCommands> = {
  readonly strokeIndex: number
  readonly availability: 'known' | 'unknown'
} & (
  | { readonly kind: 'shadowed-by-prefix'; readonly winningBinding: CompiledBinding<Commands> }
  | { readonly kind: 'prefix-unavailable'; readonly winningBinding: null }
)

type Ignored = {
  readonly strokeIndex: number
  readonly reason: 'keyup' | 'composing' | 'modifier-only' | 'repeat-on-chord-prefix' | 'repeat'
}

export type KeymapExplanation<Commands extends CommandMap = AnyCommands> = {
  readonly active: readonly CompiledBinding<Commands>[]
  readonly candidates: readonly ExplainedCandidate<Commands>[]
  readonly continuations: readonly ExplainedContinuation<Commands>[]
  readonly pending: boolean
  readonly blockedByPrefix: BlockedPrefix<Commands> | null
  readonly mismatchedAtStrokeIndex?: number
  readonly ignored?: Ignored
}

type Query = HotkeyInput | (string & {}) | readonly KeyInput[]
type Availability<Commands extends CommandMap> = {
  readonly unknown: boolean
  readonly test: (binding: CompiledBinding<Commands>) => boolean
}
type Step<Commands extends CommandMap> = {
  readonly node: KeymapNode<CompiledBinding<Commands>>
  readonly selection: KeymapSelection<CompiledBinding<Commands>>
  readonly availability: Availability<Commands>
  readonly strokeIndex: number
}
const empty = {
  active: [],
  candidates: [],
  continuations: [],
  pending: false,
  blockedByPrefix: null,
} as const

export function explainKeymap<Commands extends CommandMap = AnyCommands, Source = unknown>(
  keymap: CompiledKeymap<Commands>,
  input: Query,
  options: ExplainOptions<Source, Commands> = {},
): KeymapExplanation<Commands> {
  const inputs = isInputStream(input) ? input : queryStrokes(keymap, input)
  const stack = options.contextStack ?? []
  const availabilityAt = (index: number) => {
    const source =
      options.sources?.[index] ?? (inputs.length === 1 && index === 0 ? options.source : undefined)
    const filter = options.isAvailable
    return {
      unknown: filter !== undefined && source === undefined,
      test: (binding: CompiledBinding<Commands>) =>
        !filter || source === undefined || filter(binding, source),
    }
  }
  let step: Step<Commands> | null = null
  let blockedByPrefix: BlockedPrefix<Commands> | null = null
  let ignored: Ignored | undefined
  for (const [strokeIndex, stroke] of inputs.entries()) {
    const reason = ignoredReason(stroke, (step?.selection.pending ?? 0) > 0)
    if (reason) {
      ignored = { strokeIndex, reason }
      continue
    }
    if (step) blockedByPrefix = preferBlocker(blockedByPrefix, prefixBlocker(step))
    const availability = availabilityAt(strokeIndex)
    const node: KeymapNode<CompiledBinding<Commands>> = step ? step.node : keymap.root
    const next = selectTrieStep<CompiledBinding<Commands>>(
      node,
      stroke,
      (node) => resolveKeymapNode(node, stack, availability.test),
      true,
    )
    if (!next) return { ...empty, blockedByPrefix, mismatchedAtStrokeIndex: strokeIndex }
    const repeatedPrefix = !step && stroke.repeat && next.selection.pending > 0
    step = { node: next.edge.node, selection: next.selection, availability, strokeIndex }
    if (repeatedPrefix)
      return {
        ...explainStep(step, stack, availabilityAt, blockedByPrefix),
        active: [],
        pending: false,
        ignored: { strokeIndex, reason: 'repeat-on-chord-prefix' },
      }
  }
  if (!step) return { ...empty, ...(ignored && { ignored }) }
  return {
    ...explainStep(step, stack, availabilityAt, blockedByPrefix),
    ...(ignored && { ignored }),
  }
}

function isInputStream(input: Query): input is readonly KeyInput[] {
  return (
    Array.isArray(input) &&
    input.length > 0 &&
    typeof input[0] === 'object' &&
    'composing' in input[0]
  )
}

function queryStrokes<Commands extends CommandMap>(
  keymap: CompiledKeymap<Commands>,
  input: Exclude<Query, readonly KeyInput[]>,
): readonly KeyInput[] {
  if (Array.isArray(input) && input.length === 0) return []
  return requireShortcut(input).map((stroke) => {
    const parsed = parseHotkey(stroke, keymap.platform)
    return createKeyInput({ key: parsed.key ?? '', code: parsed.code, modifiers: parsed })
  })
}

function ignoredReason(input: KeyInput, pending: boolean): Ignored['reason'] | undefined {
  if (input.type === 'keyup') return 'keyup'
  if (input.composing) return 'composing'
  if (isModifierKey(input.key)) return 'modifier-only'
  if (pending && input.repeat) return 'repeat'
  return undefined
}

function prefixBlocker<Commands extends CommandMap>(
  step: Step<Commands>,
): BlockedPrefix<Commands> | null {
  if (step.selection.pending) return null
  const strokeIndex = step.strokeIndex
  const availability = step.availability.unknown ? 'unknown' : 'known'
  const winningBinding = step.selection.bindings[0]?.payload
  return winningBinding
    ? { kind: 'shadowed-by-prefix', strokeIndex, winningBinding, availability }
    : { kind: 'prefix-unavailable', strokeIndex, winningBinding: null, availability }
}

function preferBlocker<Commands extends CommandMap>(
  previous: BlockedPrefix<Commands> | null,
  next: BlockedPrefix<Commands> | null,
): BlockedPrefix<Commands> | null {
  if (previous?.availability === 'known') return previous
  if (next?.availability === 'known') return next
  return previous ?? next
}

function explainStep<Commands extends CommandMap>(
  step: Step<Commands>,
  stack: readonly KeyContext[],
  availabilityAt: (index: number) => Availability<Commands>,
  blockedByPrefix: BlockedPrefix<Commands> | null,
): KeymapExplanation<Commands> {
  const knownBlocker = blockedByPrefix?.availability === 'known' ? blockedByPrefix : null
  const removed = new Map<number, CompiledBinding<Commands>>()
  effectiveBindings(step.node.candidates, stack, step.availability.test, (candidate, blocker) =>
    removed.set(candidate.index, blocker),
  )
  const active = knownBlocker ? [] : step.selection.bindings.map(({ payload }) => payload)
  const candidates = step.node.candidates.map(({ payload }) =>
    candidateReport(payload, stack, step.availability, removed, knownBlocker),
  )
  return {
    active,
    candidates,
    continuations: continuationsFrom(step, stack, availabilityAt, blockedByPrefix),
    pending: !knownBlocker && step.selection.pending > 0,
    blockedByPrefix,
  }
}

function candidateReport<Commands extends CommandMap>(
  binding: CompiledBinding<Commands>,
  stack: readonly KeyContext[],
  available: Availability<Commands>,
  removed: ReadonlyMap<number, CompiledBinding<Commands>>,
  prefix: BlockedPrefix<Commands> | null,
): ExplainedCandidate<Commands> {
  const depth = predicateDepth(binding.predicate, stack)
  const base = { binding, depth, rank: binding.rank, blockedByIndex: null }
  if (prefix?.kind === 'shadowed-by-prefix')
    return { ...base, status: prefix.kind, blockedByIndex: prefix.winningBinding.index }
  if (prefix || !available.test(binding)) return { ...base, status: 'unavailable' }
  if (depth === null) return { ...base, status: 'context-mismatch' }
  if (available.unknown) return { ...base, status: 'availability-unknown' }
  const blocker = removed.get(binding.index)
  if (blocker)
    return {
      ...base,
      status: blocker.unbind === null ? 'shadowed' : 'unbound',
      blockedByIndex: blocker.index,
    }
  return { ...base, status: binding.command === null ? 'unbound' : 'matched' }
}

function continuationsFrom<Commands extends CommandMap>(
  step: Step<Commands>,
  stack: readonly KeyContext[],
  availabilityAt: (index: number) => Availability<Commands>,
  blockedByPrefix: BlockedPrefix<Commands> | null,
): ExplainedContinuation<Commands>[] {
  const reports: ExplainedContinuation<Commands>[] = []
  const queue = [{ step, prior: blockedByPrefix, earliest: -1 }]
  for (const visit of queue) {
    const { selection, strokeIndex } = visit.step
    if (visit.step !== step) appendContinuations(reports, visit.step, visit.prior, visit.earliest)
    const prior = preferBlocker(visit.prior, prefixBlocker(visit.step))
    const index = strokeIndex + 1
    const availability = availabilityAt(index)
    const earliest = selection.bindings[0]?.payload.index ?? -1
    for (const node of childrenOf(visit.step.node)) {
      queue.push({
        step: {
          node,
          selection: resolveKeymapNode(node, stack, availability.test),
          availability,
          strokeIndex: index,
        },
        prior,
        earliest,
      })
    }
  }
  return reports.sort((a, b) => a.binding.index - b.binding.index)
}

function* childrenOf<Payload>(node: KeymapNode<Payload>) {
  for (const children of node.next.values()) {
    for (const edge of children) {
      if (edge) yield edge.node
    }
  }
}

function appendContinuations<Commands extends CommandMap>(
  reports: ExplainedContinuation<Commands>[],
  step: Step<Commands>,
  prior: BlockedPrefix<Commands> | null,
  earliest: number,
) {
  for (const { payload: binding } of step.selection.bindings) {
    const winner = prior?.availability === 'known' ? prior.winningBinding : null
    const shadowedByIndex = winner?.index ?? (binding.index < earliest ? earliest : null)
    let status: ExplainedContinuation<Commands>['status'] = 'pending'
    if (step.availability.unknown || prior?.availability === 'unknown')
      status = 'availability-unknown'
    if (prior?.availability === 'known' && prior.kind === 'prefix-unavailable')
      status = 'unavailable'
    if (shadowedByIndex !== null) status = 'shadowed-by-prefix'
    reports.push({ binding, status, shadowedByIndex })
  }
}

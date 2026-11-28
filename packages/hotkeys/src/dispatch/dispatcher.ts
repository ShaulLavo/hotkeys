import { explainKeymap } from './explain.js'
import type { ExplainOptions, KeymapExplanation } from './explain.js'
import type { HotkeyInput } from '../hotkey.types.js'
import type { AnyCommands, CommandCall, CommandMap, CommandName } from './commands.js'
import { createChordRuntime } from '../chords/runtime.js'
import { detectPlatform } from '../platform.js'
import { createKeyContext, parseKeyContext } from '../context/key-context.js'
import { compileKeymap, resolveKeymapNode } from './keymap.js'
import type { KeyInput } from '../key-input.js'
import type { KeyContext, KeyContextInit } from '../context/key-context.js'
import type { KeyEffects } from '../chords/runtime.js'
import type {
  ChordOutcome,
  KeymapBinding,
  KeymapPlatform,
  KeymapSequenceEvent,
  PendingChordLabel,
} from '../chords/types.js'
import type { CompiledBinding, KeymapEntry } from './keymap.js'

export type CommandEvent<
  Source,
  Commands extends CommandMap = AnyCommands,
  Name extends CommandName<Commands> = CommandName<Commands>,
> = {
  readonly command: Name
  readonly args: Commands[Name]
  /** The node that handles the command; the focused node or one of its ancestors. */
  readonly node: FocusNode<Source, Commands>
  /** The triggering stroke, including saved prefixes; null for programmatic commands. */
  readonly input: KeyInput | null
  readonly source: Source | null
}
/** Returns false to try the next handler or binding while the dispatch remains current. */
export type CommandHandler<
  Source,
  Commands extends CommandMap = AnyCommands,
  Name extends CommandName<Commands> = CommandName<Commands>,
> = (event: CommandEvent<Source, Commands, Name>) => boolean | void

export type CommandHandlers<Source, Commands extends CommandMap> = {
  readonly [Name in CommandName<Commands>]?: CommandHandler<Source, Commands, Name>
}

export type HostedFocusNode = {
  readonly id: number
  readonly parent: HostedFocusNode | null
  readonly context: () => KeyContext
}

export type FocusNodeContext = KeyContext | KeyContextInit | string
export type FocusNodeOptions<Source, Commands extends CommandMap = AnyCommands> = {
  readonly parent?: HostedFocusNode | null
  readonly context?: FocusNodeContext
  /** Samples live context for each capture, overriding the static context. */
  readonly readContext?: () => FocusNodeContext
  readonly commands?: CommandHandlers<Source, Commands>
}
/** A place focus can be. Its context joins the stack while focus is on it or inside it. */
export type FocusNode<Source, Commands extends CommandMap = AnyCommands> = HostedFocusNode & {
  readonly setContext: (context: FocusNodeContext) => void
  /** Adds a handler registration; returns that registration's removal. */
  readonly handle: <Name extends CommandName<Commands>>(
    command: Name,
    handler: CommandHandler<Source, Commands, Name>,
  ) => () => void
  readonly focus: () => void
  /** Detaches the node; focus inside it moves to its parent. */
  readonly remove: () => void
}

export type DispatcherOptions<Source, Commands extends CommandMap = AnyCommands> = {
  readonly keymap?: readonly KeymapEntry<Commands>[]
  readonly platform?: KeymapPlatform
  readonly effects?: KeyEffects<Source>
  readonly replay?: (input: KeyInput, source: Source) => void
  readonly acceptsTextInput?: (source: Source) => boolean
  /**
   * Filters bindings for this key before resolution, so an unavailable chord neither pends nor
   * swallows its prefix.
   */
  readonly isAvailable?: (binding: CompiledBinding<Commands>, source: Source) => boolean
  /**
   * Focus the host tracks beside the focused node (the DOM's active element). A pending chord
   * ends when either changes.
   */
  readonly currentFocus?: () => unknown
  readonly timeoutMs?: number
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<CompiledBinding<Commands>>) => void
  readonly onCaptureChange?: () => void
}
export type Dispatcher<Source, Commands extends CommandMap = AnyCommands> = {
  readonly createNode: (options?: FocusNodeOptions<Source, Commands>) => FocusNode<Source, Commands>
  readonly focus: (node: FocusNode<Source, Commands> | null) => void
  readonly focused: () => FocusNode<Source, Commands> | null
  /** Whether the active dispatcher owns the node and its complete ancestor path. */
  readonly hasNode: (node: HostedFocusNode) => boolean
  /** Contexts from the outermost node to the focused one. */
  readonly contextStack: () => readonly KeyContext[]
  readonly setKeymap: (entries: readonly KeymapEntry<Commands>[]) => void
  /** Offers a key; true means a binding took it. False leaves it to default input handling. */
  readonly handleKey: (input: KeyInput, source: Source, inScope?: boolean) => boolean
  /** Runs a command along the focus path without a key. */
  readonly dispatchCommand: (...call: CommandCall<Commands>) => boolean
  /** Runs a command on an owned node's path without changing focus. */
  readonly dispatchCommandFrom: (
    node: FocusNode<Source, Commands>,
    ...call: CommandCall<Commands>
  ) => boolean
  readonly explain: (
    input: HotkeyInput | (string & {}) | readonly KeyInput[],
    options?: Omit<ExplainOptions<Source, Commands>, 'isAvailable'>,
  ) => KeymapExplanation<Commands>
  readonly subscribePending: (listener: (pending: PendingChordLabel | null) => void) => () => void
  readonly pending: () => PendingChordLabel | null
  readonly wantsCapture: () => boolean
  readonly capturesKey: (input: KeyInput) => boolean
  readonly releaseAll: () => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
  readonly [Symbol.dispose]: () => void
}

type HandlerRegistration<Source> = { readonly handler: CommandHandler<Source> }
type NodeState<Source, Commands extends CommandMap> = {
  node: FocusNode<Source, Commands>
  context: KeyContext
  handlers: Map<string, Set<HandlerRegistration<Source>>>
  removed: boolean
}
type Captured<Source, Commands extends CommandMap> = {
  readonly path: readonly NodeState<Source, Commands>[]
  readonly stack: readonly KeyContext[]
  readonly revision: number
  readonly focus: unknown
}

const NO_EFFECTS: KeyEffects<unknown> = {
  preventDefault: () => {},
  stopPropagation: () => {},
  swallow: () => {},
}

/**
 * A focus tree over one keymap. Keys resolve against the focus path's contexts the way Zed does:
 * deepest context first, then source, then table order; a declined command falls through.
 */
export function createDispatcher<Source = unknown, Commands extends CommandMap = AnyCommands>(
  options: DispatcherOptions<Source, Commands> = {},
): Dispatcher<Source, Commands> {
  const platform = options.platform ?? detectPlatform()
  const states = new Map<HostedFocusNode, NodeState<Source, Commands>>()
  let focusedNode: FocusNode<Source, Commands> | null = null
  let disposed = false
  let commandRevision = 0
  let nextId = 1
  let keymap = compileKeymap<Commands>(options.keymap ?? [], platform)
  const { isAvailable } = options

  const runtime = createChordRuntime<CompiledBinding<Commands>, Captured<Source, Commands>, Source>(
    {
      trie: keymap.root,
      platform,
      effects: options.effects ?? (NO_EFFECTS as KeyEffects<Source>),
      captureContext: capture,
      select: (node, captured, source) =>
        resolveKeymapNode(
          node,
          captured.stack,
          isAvailable && ((binding) => isAvailable(binding, source)),
        ),
      dispatch: runBinding,
      currentFocus,
      replay: options.replay,
      acceptsTextInput: options.acceptsTextInput,
      timeoutMs: options.timeoutMs,
      onPendingChange: options.onPendingChange,
      onSequence: options.onSequence,
      onCaptureChange: options.onCaptureChange,
    },
  )
  // One object per focus pair, so the runtime compares focus by identity.
  let focusIdentity: { readonly node: FocusNode<Source, Commands> | null; readonly host: unknown } =
    {
      node: null,
      host: undefined,
    }

  function currentFocus() {
    const host = options.currentFocus?.()
    if (focusIdentity.node !== focusedNode || focusIdentity.host !== host)
      focusIdentity = { node: focusedNode, host }
    return focusIdentity
  }

  function focusPath(start: HostedFocusNode | null = focusedNode): NodeState<Source, Commands>[] {
    const path: NodeState<Source, Commands>[] = []
    for (let node = start; node; node = node.parent) {
      const state = states.get(node)
      if (!state) return []
      path.push(state)
    }
    return path.reverse()
  }
  function hasNode(node: HostedFocusNode): boolean {
    if (disposed) return false
    for (let current: HostedFocusNode | null = node; current; current = current.parent) {
      if (!states.has(current)) return false
    }
    return true
  }
  function capture(): Captured<Source, Commands> {
    const revision = commandRevision
    const focus = currentFocus()
    const path = focusPath()
    return { path, stack: stackFor(path), revision, focus }
  }
  function stackFor(path: readonly NodeState<Source, Commands>[]): KeyContext[] {
    const stack: KeyContext[] = []
    for (const state of path) {
      const context = state.node.context()
      if (context.identifiers.size || context.values.size) stack.push(context)
    }
    return stack
  }
  function runBinding(
    binding: KeymapBinding<CompiledBinding<Commands>>,
    captured: Captured<Source, Commands>,
    source: Source,
    input: KeyInput,
  ): boolean {
    const { command, entry } = binding.payload
    if (command === null) return false
    const args = 'args' in entry ? entry.args : undefined
    return runCommand(captured.path, command, args, input, source, captured)
  }
  function commandIsCurrent(captured: Captured<Source, Commands> | undefined): boolean {
    if (disposed) return false
    if (!captured) return true
    if (captured.revision !== commandRevision) return false
    const focus = currentFocus()
    return !disposed && captured.revision === commandRevision && captured.focus === focus
  }
  function runCommand(
    path: readonly NodeState<Source, Commands>[],
    command: string,
    args: unknown,
    input: KeyInput | null,
    source: Source | null,
    captured?: Captured<Source, Commands>,
  ): boolean {
    if (!commandIsCurrent(captured)) return false
    const notifications = path.map((state) => ({
      state,
      registrations: Array.from(state.handlers.get(command) ?? []),
    }))
    for (let index = notifications.length - 1; index >= 0; index -= 1) {
      const { state, registrations } = notifications[index]!
      for (const registration of registrations) {
        if (!commandIsCurrent(captured)) return false
        if (!hasNode(state.node) || !state.handlers.get(command)?.has(registration)) continue
        if (
          registration.handler({
            command,
            args,
            node: state.node as unknown as FocusNode<Source>,
            input,
            source,
          }) !== false
        )
          return true
      }
    }
    return false
  }
  function createNode(
    nodeOptions: FocusNodeOptions<Source, Commands> = {},
  ): FocusNode<Source, Commands> {
    const parent = nodeOptions.parent ?? null
    const node: FocusNode<Source, Commands> = {
      id: nextId++,
      parent,
      context: () =>
        nodeOptions.readContext ? toKeyContext(nodeOptions.readContext()) : state.context,
      setContext: (context) => {
        state.context = toKeyContext(context)
      },
      handle: (command, handler) =>
        addHandler(state, command, handler as unknown as CommandHandler<Source>),
      focus: () => focus(node),
      remove: () => removeNode(state),
    }
    const state: NodeState<Source, Commands> = {
      node,
      context: toKeyContext(nodeOptions.context),
      handlers: new Map(),
      removed: false,
    }
    states.set(node, state)
    for (const [command, handler] of Object.entries(nodeOptions.commands ?? {}))
      addHandler(state, command, handler as unknown as CommandHandler<Source>)
    return node
  }
  function addHandler(
    state: NodeState<Source, Commands>,
    command: string,
    handler: CommandHandler<Source>,
  ) {
    let handlers = state.handlers.get(command)
    if (!handlers) state.handlers.set(command, (handlers = new Set()))
    const registration = { handler }
    handlers.add(registration)
    return () => {
      handlers.delete(registration)
    }
  }
  function removeNode(state: NodeState<Source, Commands>) {
    if (state.removed) return
    state.removed = true
    if (isInside(focusedNode, state.node)) focus(nearestLive(state.node.parent))
    states.delete(state.node)
  }
  function nearestLive(node: HostedFocusNode | null): FocusNode<Source, Commands> | null {
    while (node && states.get(node)?.removed !== false) node = node.parent
    return node ? (states.get(node)?.node ?? null) : null
  }
  function focus(node: FocusNode<Source, Commands> | null) {
    if (node && !hasNode(node)) return
    focusedNode = node
  }
  function setKeymap(entries: readonly KeymapEntry<Commands>[]) {
    keymap = compileKeymap<Commands>(entries, platform)
    commandRevision += 1
    runtime.updateTrie(keymap.root)
  }
  function cancel(outcome?: ChordOutcome) {
    commandRevision += 1
    runtime.cancel(outcome)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    states.clear()
    focusedNode = null
    runtime.dispose()
  }
  return {
    createNode,
    focus,
    focused: () => focusedNode,
    hasNode,
    contextStack: () => stackFor(focusPath()),
    setKeymap,
    handleKey: runtime.handleKey,
    dispatchCommand: (...[command, args]) => runCommand(focusPath(), command, args, null, null),
    dispatchCommandFrom: (node, ...[command, args]) =>
      runCommand(focusPath(node), command, args, null, null),
    explain: (input, options) =>
      explainKeymap(keymap, input, {
        ...options,
        isAvailable,
        contextStack: options?.contextStack ?? stackFor(focusPath()),
      }),
    pending: runtime.pending,
    subscribePending: runtime.subscribePending,
    wantsCapture: runtime.wantsCapture,
    capturesKey: runtime.capturesKey,
    releaseAll: runtime.releaseAll,
    cancel,
    dispose,
    [Symbol.dispose]: dispose,
  }
}

function isInside(node: HostedFocusNode | null, ancestor: HostedFocusNode): boolean {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function toKeyContext(context: FocusNodeContext | undefined): KeyContext {
  if (context === undefined) return createKeyContext()
  if (typeof context === 'string') return parseKeyContext(context)
  if (context.identifiers instanceof Set && context.values instanceof Map)
    return context as KeyContext
  return createKeyContext(context as KeyContextInit)
}

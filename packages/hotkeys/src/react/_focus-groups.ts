import { compareFocusOrder, focusNodeControl } from '../dispatch/_focus-node-control.js'
import type { FocusOrder } from '../dispatch/_focus-node-control.js'
import { createKeyContext, parseKeyContext } from '@shaulavo/hotkeys'
import type {
  AnyCommands,
  BrowserDispatcher,
  CommandHandler,
  CommandMap,
  FocusNode,
  FocusNodeContext,
  KeyContext,
} from '@shaulavo/hotkeys'

type CommandName<Commands extends CommandMap> = Extract<keyof Commands, string>

export type FocusCommands<Commands extends CommandMap> = {
  readonly [Name in CommandName<Commands>]?: CommandHandler<KeyboardEvent, Commands, Name>
}

export type FocusContextReader = FocusNodeContext | (() => FocusNodeContext)

export type FocusAttachment<Commands extends CommandMap> = {
  readonly node: FocusNode<KeyboardEvent, Commands>
  readonly sync: (
    context: FocusContextReader | undefined,
    commands: FocusCommands<Commands> | undefined,
  ) => void
  readonly detach: () => void
  readonly refreshPeers: () => void
}

type GroupMember = {
  readonly order: FocusOrder
  readonly readContext: () => FocusNodeContext | undefined
  readonly resolve: () => void
}

type Group<Commands extends CommandMap> = {
  readonly node: FocusNode<KeyboardEvent, Commands>
  readonly members: GroupMember[]
  detachElement: (() => void) | undefined
}
type Parent<Commands extends CommandMap> = FocusNode<KeyboardEvent, Commands> | null
type ElementGroups<Commands extends CommandMap> = WeakMap<
  Element,
  Map<Parent<Commands>, Group<Commands>>
>

const dispatchers = new WeakMap<object, ElementGroups<AnyCommands>>()
let lastMountSequence = 0

export function nextFocusMountSequence(): number {
  return ++lastMountSequence
}

export function attachFocusNode<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands>,
  element: Element,
  parent: Parent<Commands>,
  order: FocusOrder,
  resolve: () => void,
): FocusAttachment<Commands> {
  const groups = groupsFor(dispatcher)
  let parents = groups.get(element)
  if (!parents) groups.set(element, (parents = new Map()))
  const previous = parents.get(parent)
  const group = reusableGroup(previous) ?? createGroup(dispatcher, parent)
  parents.set(parent, group)
  const { node, members } = group
  group.detachElement ??= dispatcher.attachElement(node, element)
  const handlers = new Map<CommandName<Commands>, () => void>()
  let committedContext: FocusContextReader | undefined
  let committedCommands: FocusCommands<Commands> | undefined
  const member: GroupMember = {
    order,
    resolve,
    readContext: () =>
      typeof committedContext === 'function' ? committedContext() : committedContext,
  }
  members.push(member)
  members.sort((left, right) => compareFocusOrder(left.order, right.order))

  function sync(
    context: FocusContextReader | undefined,
    commands: FocusCommands<Commands> | undefined,
  ) {
    committedContext = context
    committedCommands = commands
    for (const [command, remove] of handlers) {
      if (commands?.[command]) continue
      remove()
      handlers.delete(command)
    }
    for (const raw of Object.keys(commands ?? {})) {
      const command = raw as CommandName<Commands>
      if (handlers.has(command) || !commands?.[command]) continue
      const handler: CommandHandler<KeyboardEvent, Commands, typeof command> = (event) => {
        const handle = committedCommands?.[command]
        return handle ? handle(event) : false
      }
      const control = node[focusNodeControl]
      handlers.set(
        command,
        control ? control.handle(command, handler, order) : node.handle(command, handler),
      )
    }
  }

  function detach() {
    const index = members.indexOf(member)
    if (index < 0) return
    members.splice(index, 1)
    for (const remove of handlers.values()) remove()
    handlers.clear()
    if (members.length > 0) return

    group.detachElement?.()
    group.detachElement = undefined
    const control = node[focusNodeControl]
    if (!control) {
      discardEmptyGroup()
      return
    }
    // Ownership and handlers end synchronously. Keep the inert identity for same-turn ref churn.
    control.suspend()
    queueMicrotask(discardEmptyGroup)
  }

  return { node, sync, detach, refreshPeers }

  function refreshPeers() {
    for (const peer of members.slice()) {
      if (peer !== member && members.includes(peer)) peer.resolve()
    }
  }

  function discardEmptyGroup() {
    if (members.length > 0) return
    node.remove()
    if (parents!.get(parent) !== group) return
    parents!.delete(parent)
    if (!parents!.size) groups.delete(element)
  }
}

function reusableGroup<Commands extends CommandMap>(group: Group<Commands> | undefined) {
  if (!group) return undefined
  if (group.detachElement || group.node[focusNodeControl]?.resume()) return group
  return undefined
}

function groupsFor<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands>,
): ElementGroups<Commands> {
  let groups = dispatchers.get(dispatcher)
  if (!groups) dispatchers.set(dispatcher, (groups = new WeakMap()))
  // Only the same dispatcher can retrieve its entries, so the schema is fixed for this map.
  return groups as unknown as ElementGroups<Commands>
}

function createGroup<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands>,
  parent: Parent<Commands>,
): Group<Commands> {
  const members: GroupMember[] = []
  const node = dispatcher.createNode({ parent, readContext: () => mergeContexts(members) })
  return { node, members, detachElement: undefined }
}

function mergeContexts(members: readonly GroupMember[]): KeyContext {
  const identifiers = new Set<string>()
  const values = new Map<string, string>()
  for (const member of members) {
    const context = member.readContext()
    if (context === undefined) continue
    const normalized =
      typeof context === 'string' ? parseKeyContext(context) : createKeyContext(context)
    for (const identifier of normalized.identifiers) identifiers.add(identifier)
    for (const [key, value] of normalized.values) values.set(key, value)
  }
  return { identifiers, values }
}

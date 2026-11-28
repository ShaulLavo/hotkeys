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
  readonly readContext: () => FocusNodeContext | undefined
  readonly resolve: () => void
}

type Group<Commands extends CommandMap> = {
  readonly node: FocusNode<KeyboardEvent, Commands>
  readonly members: Set<GroupMember>
  readonly detachElement: () => void
}
type Parent<Commands extends CommandMap> = FocusNode<KeyboardEvent, Commands> | null
type ElementGroups<Commands extends CommandMap> = WeakMap<
  Element,
  Map<Parent<Commands>, Group<Commands>>
>

const dispatchers = new WeakMap<object, ElementGroups<AnyCommands>>()

export function attachFocusNode<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands>,
  element: Element,
  parent: Parent<Commands>,
  resolve: () => void,
): FocusAttachment<Commands> {
  const groups = groupsFor(dispatcher)
  let parents = groups.get(element)
  if (!parents) groups.set(element, (parents = new Map()))
  let group = parents.get(parent)
  if (!group) parents.set(parent, (group = createGroup(dispatcher, element, parent)))
  const { node, members, detachElement } = group
  const handlers = new Map<CommandName<Commands>, () => void>()
  let committedContext: FocusContextReader | undefined
  let committedCommands: FocusCommands<Commands> | undefined
  const member: GroupMember = {
    resolve,
    readContext: () =>
      typeof committedContext === 'function' ? committedContext() : committedContext,
  }
  // Attachment order also defines context merge order and initial handler order.
  members.add(member)

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
      handlers.set(
        command,
        node.handle(command, (event) => {
          const handle = committedCommands?.[command]
          return handle ? handle(event) : false
        }),
      )
    }
  }

  function detach() {
    if (!members.delete(member)) return
    for (const remove of handlers.values()) remove()
    handlers.clear()
    if (members.size > 0) return
    parents!.delete(parent)
    if (!parents!.size) groups.delete(element)
    detachElement()
    node.remove()
  }

  return { node, sync, detach, refreshPeers }

  function refreshPeers() {
    for (const peer of Array.from(members)) {
      if (peer !== member && members.has(peer)) peer.resolve()
    }
  }
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
  element: Element,
  parent: Parent<Commands>,
): Group<Commands> {
  const members = new Set<GroupMember>()
  const node = dispatcher.createNode({ parent, readContext: () => mergeContexts(members) })
  return { node, members, detachElement: dispatcher.attachElement(node, element) }
}

function mergeContexts(members: ReadonlySet<GroupMember>): KeyContext {
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

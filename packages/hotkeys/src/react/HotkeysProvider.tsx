import {
  createContext,
  useCallback,
  useContext,
  useEffectEvent,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createBrowserDispatcher } from '@shaulavo/hotkeys'
import { RegistryContext } from './_registry-context.js'
import { attachFocusNode } from './_focus-groups.js'
import { observeTargetRef } from './_focus-targets.js'
import type { FocusAttachment, FocusCommands, FocusContextReader } from './_focus-groups.js'
import type { HotkeysProviderOptions } from './_registry-context.js'
import type {
  AnyCommands,
  BrowserDispatcher,
  BrowserDispatcherOptions,
  CommandMap,
  FocusNode,
  HotkeyRegistry,
  KeymapEntry,
  PendingChordLabel,
} from '@shaulavo/hotkeys'
import type { ReactNode, Ref, RefCallback, RefObject } from 'react'

export type { HotkeysProviderOptions }

type OwnedOptions<Commands extends CommandMap> = Pick<
  BrowserDispatcherOptions<Commands>,
  'root' | 'platform' | 'timeoutMs' | 'capture' | 'isAvailable' | 'beforeKey' | 'onSequence'
>

type Ownership<Commands extends CommandMap> =
  | ({ readonly dispatcher: BrowserDispatcher<Commands>; readonly keymap?: never } & {
      readonly [Key in keyof OwnedOptions<Commands>]?: never
    })
  | ({
      readonly dispatcher?: never
      readonly keymap: readonly KeymapEntry<Commands>[]
    } & OwnedOptions<Commands>)
  | ({ readonly dispatcher?: never; readonly keymap?: never } & {
      readonly [Key in keyof OwnedOptions<Commands>]?: never
    })

export type HotkeysProviderProps<Commands extends CommandMap = AnyCommands> =
  Ownership<Commands> & {
    readonly children?: ReactNode
    readonly registry?: HotkeyRegistry
    readonly defaultOptions?: HotkeysProviderOptions
  }

type Node<Commands extends CommandMap> = FocusNode<KeyboardEvent, Commands>

export type UseFocusNodeOptions<Commands extends CommandMap = AnyCommands> = {
  readonly context?: FocusContextReader
  readonly commands?: FocusCommands<Commands>
  readonly parent?: Node<Commands> | null
  /**
   * Explicit target element or ref. When supplied, the returned callback `ref` does nothing.
   * A `RefObject` resolves on the hook owner's commits, on observed DOM mutations, and before
   * key dispatch. For synchronous `nodeForElement` lookup across detached remounts when the
   * hook owner does not commit, omit `target` and attach the returned callback `ref`.
   */
  readonly target?: RefObject<Element | null> | Element | null
  readonly enabled?: boolean
}

export type UseFocusNodeResult<Commands extends CommandMap = AnyCommands> = {
  /**
   * Immediate attachment callback ref. When `target` is omitted, this callback attaches on
   * mount or remount, including detached portals, once the dispatcher and parent are ready.
   * When `target` is supplied, this callback does nothing.
   */
  readonly ref: RefCallback<Element>
  readonly node: Node<Commands> | null
  readonly dispatcher: BrowserDispatcher<Commands> | null
}

/**
 * Props for `FocusScope`. Renders a wrapper `<div>` and attaches to it immediately through
 * the callback `ref` when `target` is omitted.
 */
export type FocusScopeProps<Commands extends CommandMap = AnyCommands> =
  UseFocusNodeOptions<Commands> & {
    readonly children?: ReactNode
    readonly ref?: Ref<HTMLDivElement>
    readonly id?: string
    readonly className?: string
  }

export type TypedHotkeysContext<Commands extends CommandMap> = {
  readonly HotkeysProvider: (props: HotkeysProviderProps<Commands>) => ReactNode
  /**
   * Renders a wrapper `<div>` bound to a focus node and provides that node to descendants.
   * When `target` is omitted, `FocusScope` attaches immediately to its wrapper `<div>` on
   * mount or remount, including detached portals, once the dispatcher and parent are ready.
   * A supplied `RefObject` `target` resolves on the hook owner's commits, on observed DOM
   * mutations, and before key dispatch. For synchronous `nodeForElement` lookup across
   * detached remounts when the hook owner does not commit, omit `target` and use the
   * default wrapper.
   */
  readonly FocusScope: (props: FocusScopeProps<Commands>) => ReactNode
  /**
   * Attaches a focus node to an element in the nearest `HotkeysProvider` dispatcher.
   * When `target` is omitted, the returned callback `ref` attaches immediately on mount or
   * remount, including detached portals, once the dispatcher and parent are ready. A
   * supplied `RefObject` `target` resolves on the hook owner's commits, on observed DOM
   * mutations, and before key dispatch. For synchronous `nodeForElement` lookup across
   * detached remounts when the hook owner does not commit, omit `target` and attach the
   * returned callback `ref` to the element.
   */
  readonly useFocusNode: (options: UseFocusNodeOptions<Commands>) => UseFocusNodeResult<Commands>
  readonly useHotkeysDispatcher: () => BrowserDispatcher<Commands> | null
  readonly usePendingChord: () => PendingChordLabel | null
}

type FocusContext<Commands extends CommandMap> = {
  readonly dispatcher: BrowserDispatcher<Commands> | null
  readonly configured: boolean
}
type CommitStore<Value> = {
  readonly read: () => Value | null
  readonly write: (value: Value | null) => void
  readonly subscribe: (listener: () => void) => () => void
}

type ParentScope<Commands extends CommandMap> = Pick<
  CommitStore<BoundNode<Commands>>,
  'read' | 'subscribe'
>

const noPending = () => null
const noSubscribe = () => () => {}

export function createHotkeysContext<
  Commands extends CommandMap = AnyCommands,
>(): TypedHotkeysContext<Commands> {
  const DispatcherContext = createContext<FocusContext<Commands>>({
    dispatcher: null,
    configured: false,
  })
  const ParentContext = createContext<ParentScope<Commands> | null>(null)

  function HotkeysProvider(props: HotkeysProviderProps<Commands>) {
    const owned = useOwnedDispatcher(props)
    const dispatcher = props.dispatcher ?? owned
    const configured = props.dispatcher !== undefined || props.keymap !== undefined
    const focus = useMemo(() => ({ dispatcher, configured }), [dispatcher, configured])
    const simple = useMemo(
      () => ({ registry: props.registry, defaultOptions: props.defaultOptions }),
      [props.registry, props.defaultOptions],
    )
    return (
      <RegistryContext value={simple}>
        <DispatcherContext value={focus}>
          <ParentContext value={null}>{props.children}</ParentContext>
        </DispatcherContext>
      </RegistryContext>
    )
  }

  function useHotkeysDispatcher() {
    return useContext(DispatcherContext).dispatcher
  }

  function usePendingChord() {
    const dispatcher = useHotkeysDispatcher()
    return useSyncExternalStore(
      dispatcher?.subscribePending ?? noSubscribe,
      dispatcher?.pending ?? noPending,
      noPending,
    )
  }

  function useScopedNode(options: UseFocusNodeOptions<Commands>) {
    const { dispatcher, configured } = useContext(DispatcherContext)
    const scope = useContext(ParentContext)
    const attachment = useNodeAttachment(dispatcher, scope, options)
    if (!configured)
      throw new Error('useFocusNode requires a HotkeysProvider with a dispatcher or keymap')
    return attachment
  }

  function useFocusNode(options: UseFocusNodeOptions<Commands>) {
    return useScopedNode(options).result
  }

  function FocusScope({ children, ref, id, className, ...options }: FocusScopeProps<Commands>) {
    const ancestor = useContext(ParentContext)
    const { result: focus, scope, rollbackRef } = useScopedNode(options)
    const { ref: bindFocus } = focus
    const bind = useCallback(
      (element: HTMLDivElement | null) => {
        // Bind the scope first so the forwarded ref can read it or join its group.
        const detach = bindFocus(element)
        try {
          const detachRef = attachRef(ref, element)
          return () => {
            try {
              if (typeof detach === 'function') detach()
            } finally {
              detachRef()
            }
          }
        } catch (error) {
          rollbackRef(element)
          throw error
        }
      },
      [bindFocus, ref, rollbackRef],
    )
    return (
      <div ref={bind} id={id} className={className}>
        <ParentContext value={options.enabled === false ? ancestor : scope}>
          {children}
        </ParentContext>
      </div>
    )
  }

  return { HotkeysProvider, FocusScope, useFocusNode, useHotkeysDispatcher, usePendingChord }
}

function useOwnedDispatcher<Commands extends CommandMap>(props: HotkeysProviderProps<Commands>) {
  const { keymap, root, platform, timeoutMs, capture } = props
  const enabled = keymap !== undefined
  const hasAvailability = props.isAvailable !== undefined
  const beforeKey = useEffectEvent((event: KeyboardEvent) => props.beforeKey?.(event))
  const options = useEffectEvent(() => ({
    keymap: props.keymap,
    root,
    platform,
    timeoutMs,
    capture,
    beforeKey,
  }))
  const isAvailable = useEffectEvent<NonNullable<OwnedOptions<Commands>['isAvailable']>>(
    (binding, event) => props.isAvailable?.(binding, event) ?? true,
  )
  const onSequence = useEffectEvent<NonNullable<OwnedOptions<Commands>['onSequence']>>((event) =>
    props.onSequence?.(event),
  )
  const [owned, { write: publishOwned }] = useCommitSnapshot<BrowserDispatcher<Commands>>()
  const installedKeymap = useRef<readonly KeymapEntry<Commands>[] | undefined>(undefined)

  useLayoutEffect(() => {
    if (!enabled) return
    const initial = options()
    const dispatcher = createBrowserDispatcher<Commands>({
      ...initial,
      onSequence,
      ...(hasAvailability && { isAvailable }),
    })
    installedKeymap.current = initial.keymap
    publishOwned(dispatcher)
    return () => {
      try {
        dispatcher.dispose()
      } finally {
        publishOwned(null)
      }
    }
  }, [enabled, root, platform, timeoutMs, capture, hasAvailability, publishOwned])

  useLayoutEffect(() => {
    if (!owned || !keymap || installedKeymap.current === keymap) return
    owned.setKeymap(keymap)
    installedKeymap.current = keymap
  }, [owned, keymap])

  return enabled ? owned : null
}

type BoundNode<Commands extends CommandMap> = {
  readonly parent: Node<Commands> | null
  readonly dispatcher: BrowserDispatcher<Commands>
  readonly element: Element
  readonly attachment: FocusAttachment<Commands>
  readonly explicit: boolean
}

type FocusOptions<Commands extends CommandMap> = {
  readonly context: FocusContextReader | undefined
  readonly commands: FocusCommands<Commands> | undefined
}

function useNodeAttachment<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands> | null,
  scope: ParentScope<Commands> | null,
  { context, commands, parent, target, enabled = true }: UseFocusNodeOptions<Commands>,
): {
  readonly result: UseFocusNodeResult<Commands>
  readonly scope: ParentScope<Commands>
  readonly rollbackRef: (element: Element | null) => void
} {
  const [snapshot, binding] = useCommitSnapshot<BoundNode<Commands>>()
  const attachedRef = useRef<{ readonly element: Element } | null>(null)
  const committedOptions = useRef<FocusOptions<Commands> | undefined>(undefined)
  const canAttach = enabled && dispatcher !== null
  const explicit = target !== undefined
  const targetRef = target && 'current' in target ? target : null
  const inherited = parent === undefined ? scope : null

  useInsertionEffect(() => {
    // Descendant refs can read or dispatch through this attachment before layout effects.
    committedOptions.current = { context, commands }
    const current = binding.read()
    if (enabled && current?.dispatcher === dispatcher) current.attachment.sync(context, commands)
  }, [binding, context, commands, dispatcher, enabled])

  const release = useCallback(() => {
    const current = binding.read()
    if (!current) return
    current.attachment.detach()
    binding.write(null)
  }, [binding])

  const connect = useCallback(
    (element: Element | null, latest?: FocusOptions<Commands>) => {
      const nodeParent = inheritedParent(inherited, dispatcher, parent)
      if (!canAttach || !dispatcher || !element || nodeParent === undefined) {
        release()
        return
      }
      const current = binding.read()
      if (
        current?.element === element &&
        current.parent === nodeParent &&
        current.dispatcher === dispatcher &&
        current.explicit === explicit
      ) {
        if (latest) current.attachment.sync(latest.context, latest.commands)
        return
      }
      const attachment = attachFocusNode(dispatcher, element, nodeParent)
      if (latest) attachment.sync(latest.context, latest.commands)
      current?.attachment.detach()
      binding.write({ dispatcher, parent: nodeParent, element, attachment, explicit })
    },
    [binding, canAttach, dispatcher, explicit, inherited, parent, release],
  )

  const clearRef = useCallback(
    (entry: { readonly element: Element }) => {
      if (attachedRef.current !== entry) return
      attachedRef.current = null
      if (binding.read()?.explicit === false) release()
    },
    [binding, release],
  )

  const detachRef = useCallback(
    (entry: { readonly element: Element }) => {
      // A composed ref may detach and reattach the same element in one commit.
      queueMicrotask(() => clearRef(entry))
    },
    [clearRef],
  )

  const rollbackRef = useCallback(
    (element: Element | null) => {
      const entry = attachedRef.current
      if (entry?.element === element) clearRef(entry)
    },
    [clearRef],
  )

  const ref = useCallback(
    (element: Element | null) => {
      if (explicit) return
      if (!element) {
        if (attachedRef.current) detachRef(attachedRef.current)
        return
      }
      const entry = { element }
      attachedRef.current = entry
      connect(element, committedOptions.current)
      return () => detachRef(entry)
    },
    [connect, detachRef, explicit],
  )

  const commitAttachment = useEffectEvent(() => {
    const element =
      target === undefined ? (attachedRef.current?.element ?? null) : readTarget(target)
    connect(element, committedOptions.current)
  })
  const observation = useRef<ReturnType<typeof observeTargetRef> | null>(null)
  useLayoutEffect(() => {
    commitAttachment()
    observation.current?.refresh()
  })
  useLayoutEffect(() => {
    // A target move can change the parent's node during key processing, before React renders.
    return inherited?.subscribe(() => commitAttachment())
  }, [inherited])
  useLayoutEffect(() => {
    if (!canAttach || !targetRef || !dispatcher) return
    const targetObserver = observeTargetRef(targetRef, (element) => {
      if (element !== (binding.read()?.element ?? null)) commitAttachment()
    })
    observation.current = targetObserver
    const stopListening = dispatcher.observeKeys({ beforeKey: targetObserver.refresh })
    return () => {
      stopListening()
      targetObserver.dispose()
      observation.current = null
    }
  }, [binding, canAttach, dispatcher, targetRef])
  useLayoutEffect(() => () => release(), [release])

  const node = canAttach && snapshot?.dispatcher === dispatcher ? snapshot.attachment.node : null
  return { result: { ref, node, dispatcher }, scope: binding, rollbackRef }
}

function inheritedParent<Commands extends CommandMap>(
  scope: ParentScope<Commands> | null,
  dispatcher: BrowserDispatcher<Commands> | null,
  explicitParent: Node<Commands> | null | undefined,
): Node<Commands> | null | undefined {
  if (!scope) return explicitParent ?? null
  const binding = scope.read()
  return binding?.dispatcher === dispatcher ? binding.attachment.node : undefined
}

function readTarget(target: Exclude<UseFocusNodeOptions['target'], undefined>): Element | null {
  return target && 'current' in target ? target.current : target
}

function useCommitSnapshot<Value>() {
  const [store] = useState<CommitStore<Value>>(() => {
    let current: Value | null = null
    const listeners = new Set<() => void>()
    return {
      read: () => current,
      write: (value) => {
        if (Object.is(value, current)) return
        current = value
        for (const listener of Array.from(listeners)) {
          if (listeners.has(listener)) listener()
        }
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    }
  })
  return [useSyncExternalStore(store.subscribe, store.read, noPending), store] as const
}

function attachRef<T>(ref: Ref<T> | undefined, element: T | null): () => void {
  if (!ref) return noSubscribe()
  if (typeof ref === 'function') {
    const cleanup = ref(element)
    return typeof cleanup === 'function' ? cleanup : () => void ref(null)
  }
  ref.current = element
  return () => {
    ref.current = null
  }
}

const defaultHotkeys = /* @__PURE__ */ createHotkeysContext()
function defaultBinding<Name extends keyof TypedHotkeysContext<AnyCommands>>(name: Name) {
  return defaultHotkeys[name]
}
export const HotkeysProvider = /* @__PURE__ */ defaultBinding('HotkeysProvider')
/**
 * Renders a wrapper `<div>` bound to a focus node and provides that node to descendants.
 * When `target` is omitted, `FocusScope` attaches immediately to its wrapper `<div>` on
 * mount or remount, including detached portals, once the dispatcher and parent are ready.
 * A supplied `RefObject` `target` resolves on the hook owner's commits, on observed DOM
 * mutations, and before key dispatch. For synchronous `nodeForElement` lookup across
 * detached remounts when the hook owner does not commit, omit `target` and use the
 * default wrapper.
 */
export const FocusScope = /* @__PURE__ */ defaultBinding('FocusScope')
/**
 * Attaches a focus node to an element in the nearest `HotkeysProvider` dispatcher.
 * When `target` is omitted, the returned callback `ref` attaches immediately on mount or
 * remount, including detached portals, once the dispatcher and parent are ready. A
 * supplied `RefObject` `target` resolves on the hook owner's commits, on observed DOM
 * mutations, and before key dispatch. For synchronous `nodeForElement` lookup across
 * detached remounts when the hook owner does not commit, omit `target` and attach the
 * returned callback `ref` to the element.
 */
export const useFocusNode = /* @__PURE__ */ defaultBinding('useFocusNode')
export const useHotkeysDispatcher = /* @__PURE__ */ defaultBinding('useHotkeysDispatcher')
export const usePendingChord = /* @__PURE__ */ defaultBinding('usePendingChord')

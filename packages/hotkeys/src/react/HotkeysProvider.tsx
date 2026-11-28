import {
  createContext,
  useCallback,
  useContext,
  useEffectEvent,
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
  readonly target?: RefObject<Element | null> | Element | null
  readonly enabled?: boolean
}

export type UseFocusNodeResult<Commands extends CommandMap = AnyCommands> = {
  readonly ref: RefCallback<Element>
  readonly node: Node<Commands> | null
  readonly dispatcher: BrowserDispatcher<Commands> | null
}

export type FocusScopeProps<Commands extends CommandMap = AnyCommands> =
  UseFocusNodeOptions<Commands> & {
    readonly children?: ReactNode
    readonly ref?: Ref<HTMLDivElement>
    readonly id?: string
    readonly className?: string
  }

export type TypedHotkeysContext<Commands extends CommandMap> = {
  readonly HotkeysProvider: (props: HotkeysProviderProps<Commands>) => ReactNode
  readonly FocusScope: (props: FocusScopeProps<Commands>) => ReactNode
  readonly useFocusNode: (options: UseFocusNodeOptions<Commands>) => UseFocusNodeResult<Commands>
  readonly useHotkeysDispatcher: () => BrowserDispatcher<Commands> | null
  readonly usePendingChord: () => PendingChordLabel | null
}

type FocusContext<Commands extends CommandMap> = {
  readonly dispatcher: BrowserDispatcher<Commands> | null
  readonly configured: boolean
}
type ParentScope<Commands extends CommandMap> = {
  readonly node: Node<Commands> | null
  readonly ready: boolean
}

const noPending = () => null
const noSubscribe = () => () => {}

export function createHotkeysContext<
  Commands extends CommandMap = AnyCommands,
>(): TypedHotkeysContext<Commands> {
  const DispatcherContext = createContext<FocusContext<Commands>>({
    dispatcher: null,
    configured: false,
  })
  const ParentContext = createContext<ParentScope<Commands>>({ node: null, ready: true })

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
          <ParentContext value={rootScope}>{props.children}</ParentContext>
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

  function useFocusNode(options: UseFocusNodeOptions<Commands>) {
    const { dispatcher, configured } = useContext(DispatcherContext)
    const scope = useContext(ParentContext)
    const parent = options.parent === undefined ? scope.node : options.parent
    const ready = options.parent !== undefined || scope.ready
    const result = useNodeAttachment(dispatcher, parent, configured && ready, options)
    if (!configured)
      throw new Error('useFocusNode requires a HotkeysProvider with a dispatcher or keymap')
    return result
  }

  function FocusScope({ children, ref, id, className, ...options }: FocusScopeProps<Commands>) {
    const ancestor = useContext(ParentContext)
    const focus = useFocusNode(options)
    const scope = useMemo(() => ({ node: focus.node, ready: focus.node !== null }), [focus.node])
    const { ref: bindFocus } = focus
    const bind = useCallback(
      (element: HTMLDivElement | null) => {
        const detachRef = attachRef(ref, element)
        try {
          const detach = bindFocus(element)
          return () => {
            try {
              if (typeof detach === 'function') detach()
            } finally {
              detachRef()
            }
          }
        } catch (error) {
          detachRef()
          throw error
        }
      },
      [bindFocus, ref],
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

const rootScope = { node: null, ready: true } as const

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
  const [owned, publishOwned] = useCommitSnapshot<BrowserDispatcher<Commands>>()
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

function useNodeAttachment<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands> | null,
  parent: Node<Commands> | null,
  ready: boolean,
  { context, commands, target, enabled = true }: UseFocusNodeOptions<Commands>,
): UseFocusNodeResult<Commands> {
  const bound = useRef<BoundNode<Commands> | null>(null)
  const pendingDetach = useRef<BoundNode<Commands> | null>(null)
  const [snapshot, publishNode] = useCommitSnapshot<BoundNode<Commands>>()
  const canAttach = enabled && ready && dispatcher !== null
  const usesExplicitTarget = target !== undefined
  const targetRef = target && 'current' in target ? target : null

  const release = useCallback(() => {
    const current = bound.current
    if (!current) return
    bound.current = null
    pendingDetach.current = null
    current.attachment.detach()
    publishNode(null)
  }, [publishNode])

  const detachRef = useCallback(
    (current: BoundNode<Commands>) => {
      if (current.explicit || bound.current !== current) return
      pendingDetach.current = current
      // A composed ref may detach and reattach the same element in one commit.
      queueMicrotask(() => {
        if (pendingDetach.current === current) release()
      })
    },
    [release],
  )

  const attach = useCallback(
    (element: Element, explicit: boolean) => {
      if (!canAttach || !dispatcher) return
      const current = bound.current
      if (
        current?.element === element &&
        current.parent === parent &&
        current.dispatcher === dispatcher &&
        current.explicit === explicit
      ) {
        pendingDetach.current = null
        return () => detachRef(current)
      }
      release()
      const attachment = attachFocusNode(dispatcher, element, parent)
      const next = { dispatcher, parent, element, attachment, explicit }
      bound.current = next
      publishNode(next)
      return () => detachRef(next)
    },
    [canAttach, detachRef, dispatcher, parent, publishNode, release],
  )

  const ref = useCallback(
    (element: Element | null) => {
      if (usesExplicitTarget) return
      if (element) return attach(element, false)
      if (bound.current) detachRef(bound.current)
      return undefined
    },
    [attach, detachRef, usesExplicitTarget],
  )

  const commitAttachment = useEffectEvent(() => {
    if (target !== undefined) {
      const element = target && 'current' in target ? target.current : target
      const current = bound.current
      if (!canAttach || !element) release()
      else if (
        current?.element !== element ||
        current.dispatcher !== dispatcher ||
        current.parent !== parent
      )
        attach(element, true)
    } else if (bound.current?.explicit) {
      release()
    }
    bound.current?.attachment.sync(context, commands)
  })

  useLayoutEffect(() => {
    commitAttachment()
  })
  useLayoutEffect(() => {
    if (!canAttach || !targetRef || !dispatcher) return
    const stopObserving = observeTargetRef(targetRef, () => commitAttachment())
    // React can move an object ref between mounted elements without a DOM mutation.
    const stopListening = dispatcher.observeKeys({
      beforeKey: () => {
        if (targetRef.current !== (bound.current?.element ?? null)) commitAttachment()
      },
    })
    return () => {
      stopListening()
      stopObserving()
    }
  }, [canAttach, dispatcher, targetRef])
  useLayoutEffect(() => () => release(), [release])

  const current = canAttach && snapshot?.dispatcher === dispatcher && snapshot.parent === parent
  return { ref, node: current ? snapshot.attachment.node : null, dispatcher }
}

function useCommitSnapshot<Value>() {
  const [store] = useState(() => {
    let current: Value | null = null
    const listeners = new Set<() => void>()
    return {
      read: () => current,
      write: (value: Value | null) => {
        if (Object.is(value, current)) return
        current = value
        for (const listener of listeners) listener()
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    }
  })
  return [useSyncExternalStore(store.subscribe, store.read, noPending), store.write] as const
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
export const FocusScope = /* @__PURE__ */ defaultBinding('FocusScope')
export const useFocusNode = /* @__PURE__ */ defaultBinding('useFocusNode')
export const useHotkeysDispatcher = /* @__PURE__ */ defaultBinding('useHotkeysDispatcher')
export const usePendingChord = /* @__PURE__ */ defaultBinding('usePendingChord')

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
import type { FocusAttachment, FocusCommands } from './_focus-groups.js'
import type { HotkeysProviderOptions } from './_registry-context.js'
import type {
  AnyCommands,
  BrowserDispatcher,
  BrowserDispatcherOptions,
  CommandMap,
  FocusNode,
  FocusNodeContext,
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
  readonly context?: FocusNodeContext | (() => FocusNodeContext)
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
        const detach = bindFocus(element)
        const detachRef = attachRef(ref, element)
        return () => {
          if (typeof detach === 'function') detach()
          detachRef()
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
}

function useNodeAttachment<Commands extends CommandMap>(
  dispatcher: BrowserDispatcher<Commands> | null,
  parent: Node<Commands> | null,
  ready: boolean,
  { context, commands, target, enabled = true }: UseFocusNodeOptions<Commands>,
): UseFocusNodeResult<Commands> {
  const bound = useRef<BoundNode<Commands> | null>(null)
  const [snapshot, publishNode] = useCommitSnapshot<BoundNode<Commands>>()
  const readContext = useEffectEvent(() => (typeof context === 'function' ? context() : context))
  const readCommands = useEffectEvent(() => commands)
  const canAttach = enabled && ready && dispatcher !== null
  const usesExplicitTarget = target !== undefined

  const attach = useCallback(
    (element: Element) => {
      if (!canAttach || !dispatcher) return
      const attachment = attachFocusNode(dispatcher, element, parent)
      const next = { dispatcher, parent, element, attachment }
      bound.current = next
      publishNode(next)
      return () => {
        attachment.detach()
        if (bound.current?.attachment !== attachment) return
        bound.current = null
        publishNode(null)
      }
    },
    [canAttach, dispatcher, parent, publishNode],
  )

  const ref = useCallback(
    (element: Element | null) => {
      if (usesExplicitTarget || element === null) return
      return attach(element)
    },
    [attach, usesExplicitTarget],
  )

  const explicitCleanup = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    if (target === undefined) {
      explicitCleanup.current?.()
      explicitCleanup.current = undefined
      return
    }
    const element = target && 'current' in target ? target.current : target
    const existing = bound.current
    if (
      canAttach &&
      existing &&
      existing.element === element &&
      existing.dispatcher === dispatcher &&
      existing.parent === parent
    )
      return
    explicitCleanup.current?.()
    explicitCleanup.current = element ? attach(element) : undefined
  })
  useLayoutEffect(
    () => () => {
      explicitCleanup.current?.()
      explicitCleanup.current = undefined
    },
    [],
  )
  useLayoutEffect(() => {
    bound.current?.attachment.sync(
      () => readContext(),
      () => readCommands(),
    )
  })

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

export const { HotkeysProvider, FocusScope, useFocusNode, useHotkeysDispatcher, usePendingChord } =
  createHotkeysContext()

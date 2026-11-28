import type { AnyCommands, CommandMap } from '../dispatch/commands.js'
import type { HostedFocusNode } from '../dispatch/dispatcher.js'
import { createDispatcher } from '../dispatch/dispatcher.js'
import { detectPlatform } from '../platform.js'
import { isDomElement, isInputElement } from '../_event-target.js'
import { attachKeyListeners, browserKeyEffects, replayTextInput } from './browser-listeners.js'
import type { Dispatcher, DispatcherOptions, FocusNode } from '../dispatch/dispatcher.js'
import type { KeyResetReason } from './browser-listeners.js'

export type BrowserDispatcherOptions<Commands extends CommandMap = AnyCommands> = Omit<
  DispatcherOptions<KeyboardEvent, Commands>,
  'effects'
> & {
  /** Where idle keys are heard; defaults to the global document. */
  readonly root?: HTMLElement | Document
  /** Hears idle keys before descendant input handlers; defaults to bubbling. */
  readonly capture?: boolean
  /** Runs before each key event is offered, for hosts that update the keymap lazily. */
  readonly beforeKey?: (event: KeyboardEvent) => void
}
export type BrowserKeyObserver = {
  /** Runs once before an offered event is matched or consumed, including claimed releases. */
  readonly beforeKey: (event: KeyboardEvent) => void
  /** Clears host bookkeeping when the dispatcher drops held-key ownership. */
  readonly reset?: (reason: KeyResetReason) => void
}
type ElementAttachment<Commands extends CommandMap> = {
  readonly node: FocusNode<KeyboardEvent, Commands>
  readonly depth: number
}
type ObserverRegistration = { readonly observer: BrowserKeyObserver }
export type BrowserDispatcher<Commands extends CommandMap = AnyCommands> = Dispatcher<
  KeyboardEvent,
  Commands
> & {
  /**
   * Ties a node to an element: a key focuses the closest attached element's deepest node.
   * Later attachments win equal-depth ties. Returns the tie's removal.
   */
  readonly attachElement: (node: HostedFocusNode, element: Element) => () => void
  /** Finds the closest attached element's node for a captured command origin. */
  readonly nodeForElement: (element: Element) => FocusNode<KeyboardEvent, Commands> | null
  /** Offers an event before DOM dispatch reaches the root, for hosts that forward keys (terminals). */
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  /** Observes the existing key pipeline; returns the observer's removal. */
  readonly asHosted: () => HostedBrowserDispatcher
  readonly observeKeys: (observer: BrowserKeyObserver) => () => void
}

export type HostedBrowserDispatcher = Pick<
  BrowserDispatcher,
  'createNode' | 'attachElement' | 'claimKeybinding' | 'observeKeys' | 'contextStack'
> & { readonly nodeForElement: (element: Element) => HostedFocusNode | null }

/** A dispatcher whose focus path follows DOM containment of attached elements. */
export function createBrowserDispatcher<Commands extends CommandMap = AnyCommands>(
  options: BrowserDispatcherOptions<Commands> = {},
): BrowserDispatcher<Commands> {
  const root = options.root ?? globalThis.document
  const platform = options.platform ?? detectPlatform()
  const nodes = new Map<Element, Set<ElementAttachment<Commands>>>()
  const observers = new Set<ObserverRegistration>()
  let disposed = false
  const doc = 'defaultView' in root ? root : root.ownerDocument
  const dispatcher = createDispatcher<KeyboardEvent, Commands>({
    acceptsTextInput: (event) => isInputElement(event.target),
    replay: replayTextInput,
    currentFocus: () => doc.activeElement,
    ...options,
    platform,
    effects: browserKeyEffects,
    onCaptureChange: () => {
      listeners.syncCapture()
      options.onCaptureChange?.()
    },
  })
  const listeners = attachKeyListeners(
    root,
    platform,
    () => dispatcher,
    focusFromEvent,
    reset,
    options.capture,
  )

  function focusFromEvent(event: KeyboardEvent) {
    options.beforeKey?.(event)
    notifyObservers((observer) => observer.beforeKey(event))
    if (!nodes.size || event.type !== 'keydown') return
    for (const target of event.composedPath()) {
      const node = isDomElement(target) ? attachedNode(target) : undefined
      if (node) return dispatcher.focus(node)
    }
    dispatcher.focus(null)
  }
  function attachElement(node: HostedFocusNode, element: Element) {
    if (!dispatcher.hasNode(node)) return () => {}
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) depth += 1
    const attachment = { node: node as FocusNode<KeyboardEvent, Commands>, depth }
    const attached = nodes.get(element) ?? new Set<ElementAttachment<Commands>>()
    nodes.set(element, attached)
    attached.add(attachment)
    syncAttachedFocus(element)
    return () => {
      attached.delete(attachment)
      if (!attached.size && nodes.get(element) === attached) nodes.delete(element)
    }
  }
  function syncAttachedFocus(element: Element) {
    const active = element.ownerDocument.activeElement
    if (!active || !element.contains(active)) return
    const next = nodeForElement(active)
    if (!next) return
    const current = dispatcher.focused()
    if (!current) return dispatcher.focus(next)
    for (let ancestor: HostedFocusNode | null = next; ancestor; ancestor = ancestor.parent) {
      if (ancestor === current) return dispatcher.focus(next)
    }
  }
  function attachedNode(element: Element) {
    let selected: ElementAttachment<Commands> | undefined
    for (const attachment of nodes.get(element) ?? []) {
      if (!dispatcher.hasNode(attachment.node)) continue
      if (!selected || attachment.depth >= selected.depth) selected = attachment
    }
    return selected?.node
  }
  function nodeForElement(element: Element) {
    if (disposed) return null
    for (let current: Element | null = element; current; current = parentElement(current)) {
      const node = attachedNode(current)
      if (node) return node
    }
    return null
  }
  function parentElement(element: Element) {
    if (element.parentElement) return element.parentElement
    const root = element.getRootNode()
    const DOM = element.ownerDocument.defaultView ?? globalThis
    return root instanceof DOM.ShadowRoot ? root.host : null
  }
  function observeKeys(observer: BrowserKeyObserver) {
    if (disposed) return () => {}
    const registration = { observer }
    observers.add(registration)
    return () => void observers.delete(registration)
  }
  function notifyObservers(notify: (observer: BrowserKeyObserver) => void) {
    for (const registration of Array.from(observers)) {
      if (observers.has(registration)) notify(registration.observer)
    }
  }
  function reset(reason: KeyResetReason) {
    notifyObservers((observer) => observer.reset?.(reason))
  }
  const hosted: HostedBrowserDispatcher = {
    // Hosted registrations supply their own runtime arg checks and share the same focus tree.
    createNode: dispatcher.createNode as unknown as HostedBrowserDispatcher['createNode'],
    attachElement,
    nodeForElement,
    claimKeybinding: listeners.claim,
    observeKeys,
    contextStack: dispatcher.contextStack,
  }
  function dispose() {
    if (disposed) return
    disposed = true
    try {
      dispatcher.dispose()
    } finally {
      listeners.dispose()
      nodes.clear()
      try {
        reset('dispose')
      } finally {
        observers.clear()
      }
    }
  }
  return {
    ...dispatcher,
    attachElement,
    nodeForElement,
    claimKeybinding: listeners.claim,
    observeKeys,
    releaseAll: () => {
      dispatcher.releaseAll()
      reset('releaseAll')
    },
    asHosted: () => hosted,
    dispose,
    [Symbol.dispose]: dispose,
  }
}

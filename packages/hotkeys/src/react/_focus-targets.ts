import type { RefObject } from 'react'

type ObservedRoot = {
  readonly observers: Set<() => void>
  readonly native: MutationObserver
}

type Subscription = {
  readonly root: WeakRef<Node>
  readonly release: () => void
}

const roots = new WeakMap<Node, ObservedRoot>()

export function observeTargetRef(
  ref: RefObject<Element | null>,
  reconcile: (element: Element | null) => void,
) {
  let documentSubscription = subscribe(ref.current?.ownerDocument ?? document, refresh)
  let subtreeSubscription: Subscription | undefined
  refresh()
  return { refresh, dispose }

  function refresh() {
    const element = ref.current
    // Null ends the attachment. The last location can still receive a replacement.
    if (element) observeLocation(element)
    reconcile(element)
  }

  function observeLocation(element: Element) {
    const owner = element.ownerDocument
    if (documentSubscription.root.deref() !== owner) {
      documentSubscription.release()
      documentSubscription = subscribe(owner, refresh)
    }

    const root = element.getRootNode()
    const subtree = root === owner ? undefined : root
    if (subtreeSubscription) {
      const observedRoot = subtreeSubscription.root.deref()
      if (observedRoot && observedRoot === subtree) return
      subtreeSubscription.release()
    }
    subtreeSubscription = subtree ? subscribe(subtree, refresh) : undefined
  }

  function dispose() {
    subtreeSubscription?.release()
    documentSubscription.release()
  }
}

function subscribe(root: Node, resolve: () => void): Subscription {
  let observed = roots.get(root)
  if (!observed) {
    const observers = new Set<() => void>()
    const owner = root.ownerDocument ?? (root as Document)
    const Observer = owner.defaultView?.MutationObserver ?? MutationObserver
    const native = new Observer(() => {
      for (const observer of Array.from(observers)) {
        if (observers.has(observer)) observer()
      }
    })
    native.observe(root, { subtree: true, childList: true })
    roots.set(root, (observed = { observers, native }))
  }
  const { observers, native } = observed
  observers.add(resolve)
  // Let a detached subtree disappear if its last owner releases it while the ref is null.
  const target = new WeakRef(root)
  return { root: target, release }

  function release() {
    if (!observers.delete(resolve) || observers.size) return
    native.disconnect()
    const element = target.deref()
    if (element) roots.delete(element)
  }
}

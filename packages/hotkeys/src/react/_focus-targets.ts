import type { RefObject } from 'react'

type ObservedRoot = {
  readonly observers: Set<() => void>
  readonly native: MutationObserver
}

const roots = new WeakMap<Node, ObservedRoot>()

export function observeTargetRef(
  ref: RefObject<Element | null>,
  reconcile: (element: Element | null) => void,
) {
  let root = ref.current?.getRootNode() ?? document
  let release = subscribe(root, refresh)
  return { refresh, dispose: () => release() }

  function refresh() {
    const element = ref.current
    // Keep observing a detached subtree so its later insertion preserves removal tracking.
    const nextRoot = element?.getRootNode() ?? root
    if (nextRoot !== root) {
      release()
      root = nextRoot
      release = subscribe(root, refresh)
    }
    reconcile(element)
  }
}

function subscribe(root: Node, resolve: () => void): () => void {
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
  return () => {
    if (!observers.delete(resolve) || observers.size) return
    native.disconnect()
    roots.delete(root)
  }
}

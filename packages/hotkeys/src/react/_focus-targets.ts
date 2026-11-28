import type { RefObject } from 'react'

type ObservedRoot = {
  readonly observers: Set<() => void>
  readonly native: MutationObserver
}

const roots = new WeakMap<Node, ObservedRoot>()

export function observeTargetRef(ref: RefObject<Element | null>, onChange: () => void): () => void {
  let element = ref.current
  let root = connectedRoot(element)
  let release = subscribe(root, resolve)
  return () => release()

  function resolve() {
    const next = ref.current
    const nextRoot = connectedRoot(next, root)
    if (nextRoot !== root) {
      release()
      root = nextRoot
      release = subscribe(root, resolve)
    }
    if (next === element) return
    element = next
    onChange()
  }
}

function connectedRoot(element: Element | null, fallback: Node = document): Node {
  return element?.isConnected ? element.getRootNode() : fallback
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

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
  let owner: Document | undefined
  let localRoot: Node | null = null
  let releaseDocument: (() => void) | undefined
  let releaseLocalRoot: (() => void) | undefined
  refresh()
  return { refresh, dispose }

  function refresh() {
    const element = ref.current
    const nextOwner = element?.ownerDocument ?? owner ?? document
    if (nextOwner !== owner) {
      releaseDocument?.()
      owner = nextOwner
      releaseDocument = subscribe(owner, refresh)
    }

    // A target may move back into the document while its old subtree remains detached.
    const nextRoot = element ? element.getRootNode() : connectedShadowRoot(localRoot)
    const extraRoot = nextRoot === owner ? null : nextRoot
    if (extraRoot !== localRoot) {
      releaseLocalRoot?.()
      localRoot = extraRoot
      releaseLocalRoot = localRoot ? subscribe(localRoot, refresh) : undefined
    }
    reconcile(element)
  }

  function dispose() {
    releaseLocalRoot?.()
    releaseDocument?.()
  }
}

function connectedShadowRoot(root: Node | null): Node | null {
  return root?.isConnected && 'host' in root ? root : null
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

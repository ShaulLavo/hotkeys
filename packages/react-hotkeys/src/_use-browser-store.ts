import { useMemo, useSyncExternalStore } from 'react'

interface ReadableStore<State> {
  get(): State
  subscribe(listener: () => void): { unsubscribe(): void }
}

function createBrowserSource<State>(getStore: () => ReadableStore<State>, serverState: State) {
  let store: ReadableStore<State> | undefined

  return {
    getSnapshot: () => store?.get() ?? serverState,
    subscribe: (onChange: () => void) => {
      store = getStore()
      const subscription = store.subscribe(onChange)
      // The singleton may also serve core consumers or other React roots.
      return () => subscription.unsubscribe()
    },
  }
}

/**
 * Acquires a browser singleton only when React subscribes after commit.
 * Selectors must return a stable value for an unchanged state, as required by
 * useSyncExternalStore. The current callers select stored objects or booleans.
 */
export function useBrowserStore<State, Selection>(
  getStore: () => ReadableStore<State>,
  serverState: State,
  select: (state: State) => Selection,
): Selection {
  const source = useMemo(() => createBrowserSource(getStore, serverState), [getStore, serverState])

  return useSyncExternalStore(
    source.subscribe,
    () => select(source.getSnapshot()),
    () => select(serverState),
  )
}

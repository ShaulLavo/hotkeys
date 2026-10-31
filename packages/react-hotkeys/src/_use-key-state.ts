import { getKeyStateTracker } from '@fregat/hotkeys'
import { useBrowserStore } from './_use-browser-store.js'
import type { KeyStateTrackerState } from '@fregat/hotkeys'

const EMPTY_KEY_STATE: KeyStateTrackerState = { heldKeys: [], heldCodes: {} }
const getKeyStateStore = () => getKeyStateTracker().store

export function useKeyState<Selection>(
  select: (state: KeyStateTrackerState) => Selection,
): Selection {
  return useBrowserStore(getKeyStateStore, EMPTY_KEY_STATE, select)
}

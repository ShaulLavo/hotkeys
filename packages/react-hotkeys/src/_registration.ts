import { isRef } from './utils.js'
import type { RegisterableHotkey, Target } from '@fregat/hotkeys'
import type { RefObject } from 'react'

export function registrationIdentity(strokes: readonly RegisterableHotkey[]): string {
  // Keep symbolic Mod distinct from literal Control/Meta before platform parsing.
  return JSON.stringify(
    strokes.map((stroke) =>
      typeof stroke === 'string'
        ? stroke
        : [
            stroke.key ?? null,
            stroke.code ?? null,
            stroke.ctrl ?? false,
            stroke.alt ?? false,
            stroke.shift ?? false,
            stroke.meta ?? false,
            stroke.mod ?? false,
          ],
    ),
  )
}

export function resolveTarget(
  target: Target | RefObject<HTMLElement | null> | null | undefined,
): Target | null {
  return isRef(target)
    ? target.current
    : (target ?? (typeof document !== 'undefined' ? document : null))
}

import { isRef } from './utils.js'
import { parseRegisterableHotkey } from '@fregat/hotkeys'
import type { RegisterableHotkey, Target } from '@fregat/hotkeys'
import type { RefObject } from 'react'

export function registrationIdentity(strokes: readonly RegisterableHotkey[]): string {
  // Both modifier platforms distinguish symbolic Mod from literals while normalizing aliases.
  return JSON.stringify(
    strokes.map((stroke) => {
      const control = parseRegisterableHotkey(stroke, 'linux')
      const meta = parseRegisterableHotkey(stroke, 'mac')
      return [
        control.key ?? null,
        control.code ?? null,
        control.ctrl,
        control.alt,
        control.shift,
        control.meta,
        meta.ctrl,
        meta.meta,
      ]
    }),
  )
}

export function resolveTarget(
  target: Target | RefObject<HTMLElement | null> | null | undefined,
): Target | null {
  return isRef(target)
    ? target.current
    : (target ?? (typeof document !== 'undefined' ? document : null))
}

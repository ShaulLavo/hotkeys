import { isRef } from './utils.js'
import { parseHotkey } from '@shaulavo/hotkeys'
import type { HotkeyStroke, HotkeyTarget } from '@shaulavo/hotkeys'
import type { RefObject } from 'react'

export function registrationIdentity(strokes: readonly HotkeyStroke[]): string {
  // Both modifier platforms distinguish symbolic Mod from literals while normalizing aliases.
  return JSON.stringify(
    strokes.map((stroke) => {
      const control = parseHotkey(stroke, 'linux')
      const meta = parseHotkey(stroke, 'mac')
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
  target: HotkeyTarget | RefObject<HTMLElement | null> | null | undefined,
): HotkeyTarget | null {
  return isRef(target)
    ? target.current
    : (target ?? (typeof document !== 'undefined' ? document : null))
}

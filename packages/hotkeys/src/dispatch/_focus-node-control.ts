export const focusNodeControl = Symbol('focusNodeControl')

export type FocusOrder = {
  readonly depth: number
  readonly sequence: number
}

export function compareFocusOrder(left: FocusOrder, right: FocusOrder): number {
  return right.depth - left.depth || left.sequence - right.sequence
}

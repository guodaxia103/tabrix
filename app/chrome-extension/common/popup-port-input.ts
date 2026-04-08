export interface PopupPortUpdateInput {
  currentPort: number;
  nextValue: string;
  allowEdit: boolean;
}

/**
 * Ignore port edits while the popup is busy probing or connecting, so the
 * visible port can't drift away from the in-flight connection attempt.
 */
export function resolvePopupPortUpdate(input: PopupPortUpdateInput): number {
  if (!input.allowEdit) {
    return input.currentPort;
  }

  return Number(input.nextValue);
}

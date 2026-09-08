/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * True while the user is typing into a text field (e.g. the chat box).
 *
 * Movement, flashlight and panel-toggle hotkeys are bound globally on
 * `window`, so without this check every keystroke typed into the chat input
 * — "w", "f", "i", "k"... — also drove the game underneath it. Both global
 * keydown listeners (PlayerController and App) gate on this before acting;
 * closing the chat returns focus away from the input and controls resume
 * normally.
 */
export function isTypingInField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

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

/**
 * Game keys whose browser shortcuts must not fire mid-play: Ctrl+W/A/S/D/F
 * (crouch is Ctrl, so crouch-walking presses them constantly), Space and the
 * arrows scrolling the page, and so on.
 */
export const GAME_KEYS = new Set([
  "w", "a", "s", "d", "c", "f", " ", "shift", "control",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
]);

/** Physical keys handed to the Keyboard Lock API (see lockGameInput). */
const KEYBOARD_LOCK_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyC", "KeyF"];

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void> };

/**
 * Locks the mouse to the canvas and, where supported, goes fullscreen with the
 * Keyboard Lock API. Browser-reserved shortcuts like Ctrl+W (close tab) can't
 * be cancelled with preventDefault — Chromium only delivers them to the page
 * while it is fullscreen and keyboard-locked. Escape is left unlocked so it
 * still releases the mouse / leaves fullscreen as usual. Firefox and Safari
 * have no Keyboard Lock, so there it's pointer lock only.
 */
export function lockGameInput(canvas: HTMLElement): void {
  canvas.requestPointerLock();

  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  if (!keyboard?.lock || document.fullscreenElement) return;
  document.documentElement
    .requestFullscreen()
    .then(() => keyboard.lock!(KEYBOARD_LOCK_CODES))
    .catch(() => {
      // Fullscreen refused (no user gesture, iframe policy...): play windowed.
    });
}

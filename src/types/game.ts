/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Outfit } from "../shared/outfit";

export interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flashlight: boolean;
  state: 'idle' | 'walking' | 'running' | 'crouching';
  level?: number;
  /** Hazmat suit colour chosen in the customization screen (hex string). */
  suitColor?: string;
  /** Hand-drawn helmet face (see utils/face.ts). Only in join/roster/player_look messages. */
  face?: string;
  /** Wardrobe accessories (see shared/outfit.ts). Only in join/roster/player_look messages. */
  outfit?: Outfit;
  /** Died and is spectating (server-authoritative). */
  dead?: boolean;
  /** Reached the current exit and is waiting for the other living explorers. */
  exitReady?: boolean;
  /** SKIN cheat: an EntityType name ("HOUND", ...) worn instead of the hazmat suit, or "" for none. */
  monsterSkin?: string;
  /** Level FUN: the puzzle item this explorer carries ("p1:<n>"/"p3:<n>"), or "" for none. Server-owned. */
  held?: string;
}

export type DeathAction = 'current_level' | 'level_0' | 'lobby';

/** Lobby cheat-terminal effects. Unlocked for the whole room, not just whoever typed the code. */
export type RoomCheat = 'speed' | 'stamina' | 'clip' | 'life' | 'arrow';
export const ROOM_CHEATS: readonly RoomCheat[] = ['speed', 'stamina', 'clip', 'life', 'arrow'];
/** SUDO: unlocks every room cheat at once. */
export const SUDO_CHEAT = 'sudo';

export interface RoomConfig {
  deathAction: DeathAction;
  /** Whether secret level routes are enabled for the room. */
  secretRoutes?: boolean;
}

/** Hazmat suit colours offered in the character-customization screen. */
export const SUIT_COLORS: string[] = [
  '#deb81d', // classic Level 0 yellow (default)
  '#d94f2b', // hazard orange
  '#3f7d3a', // olive green
  '#2f6f8f', // industrial teal
  '#8a3ab0', // ultraviolet
  '#b0243a', // warning red
  '#c9c2b0', // bleached grey
  '#1c1c22', // blackout
  '#e07fa8', // party pink (Level FUN)
  '#6b4a2b', // cardboard brown
  '#7fb8d9', // poolrooms blue
  '#9bc23c', // toxic lime
];

export const DEFAULT_SUIT_COLOR = SUIT_COLORS[0];

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  /** Sender's player id (absent on local system lines). */
  senderId?: string;
  /** "system" lines come from the client itself; "quick" ones are canned callouts. */
  kind?: "player" | "system" | "quick";
  /** Quick callout id (QUICK_CHAT_IDS); its text is localized at render time via `quick.<id>`. */
  quickId?: string;
  /** Horizontal distance to the sender when a quick callout arrived, in meters. */
  distance?: number;
  /** Arrival time (Date.now()), for the fading feed shown while the chat is closed. */
  receivedAt: number;
}

export interface GameSettings {
  name: string;
  mouseSensitivity: number;
  fov: number; // FOV of camera
  volumeMaster: number; // 0 to 1
  volumeHum: number; // 0 to 1
  volumeSfx: number; // 0 to 1
  ipAddress: string;
  port: string;
  /** Graphics preset. 'auto' picks one from the device on first launch. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Lower the render resolution automatically when the frame rate drops. */
  adaptiveResolution: boolean;
  /** Show the live FPS / resolution readout in the HUD. */
  showFps: boolean;
  /** Hazmat suit colour (hex), picked in the character-customization screen. */
  suitColor: string;
  /** Hand-drawn helmet face (see utils/face.ts); EMPTY_FACE for none. */
  face: string;
  /** Accessories picked at the lobby wardrobe (see shared/outfit.ts). */
  outfit: Outfit;
}

export enum ConnectionPhase {
  MENU = 'MENU',
  CONNECTING = 'CONNECTING',
  LOBBY = 'LOBBY',
  PLAYING = 'PLAYING',
  ERROR = 'ERROR',
  ESCAPED = 'ESCAPED',
  GAME_OVER = 'GAME_OVER'
}

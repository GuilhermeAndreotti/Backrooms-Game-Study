/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  /** Hand-drawn helmet face (see utils/face.ts). Only in join/roster messages. */
  face?: string;
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
];

export const DEFAULT_SUIT_COLOR = SUIT_COLORS[0];

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
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

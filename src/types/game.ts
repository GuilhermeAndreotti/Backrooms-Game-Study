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
}

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

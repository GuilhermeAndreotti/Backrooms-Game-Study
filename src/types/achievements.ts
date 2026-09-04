/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Achievement {
  id: string;
  title: string;
  description: string;
  iconName: "Trophy" | "Compass" | "Sparkles" | "Activity" | "Key" | "Skull" | "FileText" | "Lock" | "Unlock" | "Volume2" | "AlertTriangle";
  unlocked: boolean;
  unlockedAt?: string;
  hint?: string;
}

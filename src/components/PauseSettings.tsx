/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { t } from "../i18n";
import { GameSettings } from "../types/game";

interface PauseSettingsProps {
  settings: GameSettings;
  /** Applied live (and persisted) — the engine reads the new values immediately. */
  onUpdateSettings: (settings: GameSettings) => void;
}

/** In-game settings tab of the pause menu: sensitivity, FOV, volumes, graphics preset and the FPS readout. */
export const PauseSettings: React.FC<PauseSettingsProps> = ({ settings, onUpdateSettings }) => {
  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => onUpdateSettings({ ...settings, [key]: value });

  const slider = (label: string, key: "mouseSensitivity" | "fov" | "volumeMaster" | "volumeHum" | "volumeSfx", min: number, max: number, step: number, shown: string) => (
    <div>
      <div className="flex justify-between text-[10px] text-[#a28e3b] mb-1 uppercase tracking-wider">
        <span>{label}</span>
        <span className="text-[#deb81d]">{shown}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={settings[key]}
        onChange={(e) => set(key, parseFloat(e.target.value))}
        className="w-full accent-[#deb81d] h-1.5 bg-black/60 rounded cursor-pointer"
      />
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 text-left">
      <div className="max-w-xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {slider(t("menu.mouseSens"), "mouseSensitivity", 1, 10, 0.5, `${Math.round(settings.mouseSensitivity * 10)} / 10`)}
        {slider(t("menu.fov"), "fov", 60, 110, 5, `${settings.fov}°`)}
        {slider(t("menu.volMaster"), "volumeMaster", 0, 1, 0.05, `${Math.round(settings.volumeMaster * 100)}%`)}
        {slider(t("menu.volHum"), "volumeHum", 0, 1, 0.05, `${Math.round(settings.volumeHum * 100)}%`)}
        {slider(t("menu.volSfx"), "volumeSfx", 0, 1, 0.05, `${Math.round(settings.volumeSfx * 100)}%`)}

        <div>
          <div className="text-[10px] text-[#a28e3b] mb-1 uppercase tracking-wider">{t("menu.graphics")}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {(["auto", "low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => set("quality", q)}
                className={`py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                  settings.quality === q
                    ? "bg-[#deb81d] text-black border-[#deb81d]"
                    : "bg-black/40 text-[#a28e3b] border-[#a28e3b]/20 hover:border-[#deb81d]/40"
                }`}
              >
                {t(`menu.q.${q}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 cursor-pointer md:col-span-2">
          <span className="text-[10px] text-[#a28e3b] uppercase tracking-wider">{t("menu.showFps")}</span>
          <input
            type="checkbox" checked={settings.showFps}
            onChange={(e) => set("showFps", e.target.checked)}
            className="w-4 h-4 accent-[#deb81d] cursor-pointer shrink-0"
          />
        </label>
      </div>
    </div>
  );
};

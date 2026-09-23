/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { Terminal, X, Check, Skull } from "lucide-react";
import * as THREE from "three";
import { t, useLanguage } from "../i18n";
import { EntityType, WanderingEntity } from "../game/WanderingEntity";

/** The five monster bodies the SKIN cheat can hand out (mirrors GameEngine's MONSTER_SKIN_TYPES). */
const SKIN_OPTIONS = ["DULLER", "HOUND", "CLUMP", "SKIN_STEALER", "WRETCH"] as const;
export type SkinChoice = (typeof SKIN_OPTIONS)[number];

/** Static 3D thumbnail used to identify each monster in the SKIN picker. */
const MonsterSkinPreview: React.FC<{ type: SkinChoice }> = ({ type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth || 48;
    const height = canvas.clientHeight || 48;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, width / height, 0.1, 100);
    const ambient = new THREE.AmbientLight(0xffd27a, 2.2);
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(2, 4, 4);
    scene.add(ambient, key);

    const body = WanderingEntity.buildSkinMesh(type as EntityType);
    const bounds = new THREE.Box3().setFromObject(body);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 0.1);
    body.position.sub(center);
    body.rotation.y = Math.PI;
    scene.add(body);

    camera.position.set(0, maxSize * 0.08, maxSize * 2.5);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    return () => {
      scene.remove(body);
      const tintMaterials = body.userData.tintMaterials as THREE.Material[] | undefined;
      tintMaterials?.forEach((material) => material.dispose());
      renderer.dispose();
    };
  }, [type]);

  return <canvas ref={canvasRef} aria-hidden="true" className="w-12 h-12 shrink-0 pointer-events-none" />;
};

interface CheatTerminalModalProps {
  /** Tries a code; returns which cheat it unlocked, or null if it wasn't recognized. */
  onSubmit: (code: string) => "speed" | "stamina" | "clip" | "life" | "skin" | "room" | null;
  onUnlockRoom: () => void;
  /** Applies (or, with null, clears) the SKIN cheat's monster body. */
  onPickSkin: (type: SkinChoice | null) => void;
  /** Currently worn skin, if any — the picker highlights it. */
  currentSkin: SkinChoice | null;
  onClose: () => void;
}

/**
 * The lobby's cheat terminal: fixed codes (MVJM/UHUM/CLIP/LIFE/SKIN) unlock small
 * fun modifiers for the rest of the session. Unlike Level G's terminal this
 * one doesn't close on a correct code — there are five to try, so it stays
 * open and just confirms each one, until SKIN switches it to the monster
 * picker or the player backs out / presses Escape.
 */
export const CheatTerminalModal: React.FC<CheatTerminalModalProps> = ({ onSubmit, onUnlockRoom, onPickSkin, currentSkin, onClose }) => {
  useLanguage();
  const [mode, setMode] = useState<"code" | "skin">("code");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "denied" | "speed" | "stamina" | "clip" | "life" | "room">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "code") inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "skin") setMode("code");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) return;
    const result = onSubmit(code);
    setCode("");
    if (result === "skin") {
      setMode("skin");
      setStatus("idle");
    } else if (result === "room") {
      onUnlockRoom();
      onClose();
    } else if (result) {
      setStatus(result);
    } else {
      setStatus("denied");
    }
    inputRef.current?.focus();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 font-mono px-4">
      <div
        className={`w-full max-w-md bg-[#0f0a02] border-2 border-[#a86a10] rounded p-6 shadow-[0_0_40px_rgba(255,183,3,0.18)] relative ${status === "denied" ? "animate-pulse" : ""}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("term.close")}
          className="absolute top-3 right-3 text-[#ffb703]/60 hover:text-[#ffb703] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-[#ffb703] border-b border-[#a86a10]/60 pb-2">
          <Terminal className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">{t("cheat.title")}</span>
        </div>

        {mode === "code" ? (
          <form onSubmit={submit}>
            <p className="mt-4 text-[11px] text-[#ffb703]/80 uppercase leading-relaxed">{t("cheat.prompt")}</p>

            <input
              ref={inputRef}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4));
                setStatus("idle");
              }}
              autoComplete="off"
              aria-label={t("cheat.codeAria")}
              className="mt-4 w-full bg-black border border-[#a86a10] text-[#ffb703] text-3xl text-center tracking-[0.5em] py-3 rounded outline-none focus:border-[#ffb703]"
              placeholder="____"
            />

            <div className="min-h-5 mt-2 text-[11px] uppercase tracking-wider text-center">
              {status === "denied" && <span className="text-red-500 font-bold">{t("cheat.denied")}</span>}
              {status === "speed" && <span className="text-[#3cff7a] font-bold">{t("cheat.unlockedSpeed")}</span>}
              {status === "stamina" && <span className="text-[#3cff7a] font-bold">{t("cheat.unlockedStamina")}</span>}
              {status === "clip" && <span className="text-[#3cff7a] font-bold">{t("cheat.unlockedClip")}</span>}
              {status === "life" && <span className="text-[#3cff7a] font-bold">{t("cheat.unlockedLife")}</span>}
              {(status === "speed" || status === "stamina" || status === "clip" || status === "life") && (
                <div className="text-[9px] text-[#3cff7a]/70 normal-case tracking-normal">{t("cheat.roomWide")}</div>
              )}
            </div>

            <button
              type="submit"
              disabled={code.length !== 4}
              className="mt-2 w-full bg-[#a86a10] hover:bg-[#c17f14] disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold uppercase tracking-widest py-2.5 rounded text-xs cursor-pointer"
            >
              {t("cheat.submit")}
            </button>
            {currentSkin && (
              <button
                type="button"
                onClick={() => setMode("skin")}
                className="mt-2 w-full border border-[#a86a10]/60 hover:border-[#ffb703] text-[#ffb703]/80 hover:text-[#ffb703] font-bold uppercase tracking-widest py-2 rounded text-[10px] cursor-pointer"
              >
                {t("cheat.pickSkin")}
              </button>
            )}
            <div className="mt-3 text-[9px] text-[#ffb703]/40 uppercase text-center">{t("cheat.esc")}</div>
          </form>
        ) : (
          <div>
            <p className="mt-4 text-[11px] text-[#ffb703]/80 uppercase leading-relaxed">{t("cheat.pickSkin")}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                id="btn-skin-none"
                onClick={() => onPickSkin(null)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded border text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
                  !currentSkin
                    ? "bg-[#ffb703]/15 border-[#ffb703] text-[#ffb703]"
                    : "bg-black/40 border-[#a86a10]/40 text-[#ffb703]/70 hover:border-[#ffb703]/60"
                }`}
              >
                {!currentSkin && <Check className="w-3.5 h-3.5 shrink-0" />}
                {t("skin.none")}
              </button>
              {SKIN_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  id={`btn-skin-${s}`}
                  onClick={() => onPickSkin(s)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded border text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
                    currentSkin === s
                      ? "bg-[#ffb703]/15 border-[#ffb703] text-[#ffb703]"
                      : "bg-black/40 border-[#a86a10]/40 text-[#ffb703]/70 hover:border-[#ffb703]/60"
                  }`}
                >
                  {currentSkin === s ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Skull className="w-3.5 h-3.5 shrink-0 opacity-60" />}
                  <MonsterSkinPreview type={s} />
                  <span className="min-w-0 text-left">{t(`skin.${s}`)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMode("code")}
              className="mt-4 w-full border border-[#a86a10]/60 hover:border-[#ffb703] text-[#ffb703]/80 hover:text-[#ffb703] font-bold uppercase tracking-widest py-2 rounded text-[10px] cursor-pointer"
            >
              {t("cheat.back")}
            </button>
            <div className="mt-3 text-[9px] text-[#ffb703]/40 uppercase text-center">{t("cheat.esc")}</div>
          </div>
        )}
      </div>
    </div>
  );
};

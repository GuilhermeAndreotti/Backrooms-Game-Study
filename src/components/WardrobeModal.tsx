/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Check, Shirt, Shuffle, X } from "lucide-react";
import { t, useLanguage } from "../i18n";
import { FaceEditor } from "./FaceEditor";
import { SUIT_COLORS } from "../types/game";
import { animateAccessories, buildExplorerAvatar } from "../game/ExplorerAvatar";
import { OUTFIT_ITEMS, OUTFIT_SLOTS, type Outfit, type OutfitSlot } from "../shared/outfit";

export interface WardrobeLook {
  suitColor: string;
  face: string;
  outfit: Outfit;
}

/** Frees everything an avatar built for the preview owns (it shares nothing). */
function disposeAvatar(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    });
  });
}

/** A slowly turning explorer wearing the look being tried on; drag to spin it. */
const LookPreview: React.FC<{ name: string; look: WardrobeLook }> = ({ name, look }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<{ scene: THREE.Scene; avatar: THREE.Group | null; yaw: number; dragging: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff3d6, 0x3a3320, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    // Framed to fit the tallest pieces too (the balloon floats ~2.4 m up).
    camera.position.set(0, 1.4, 5.0);
    camera.lookAt(0, 1.15, 0);
    const stage = { scene, avatar: null as THREE.Group | null, yaw: 0.5, dragging: false };
    stageRef.current = stage;

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
      }
      if (!stage.dragging) stage.yaw += dt * 0.5;
      if (stage.avatar) {
        stage.avatar.rotation.y = stage.yaw;
        animateAccessories(stage.avatar, dt);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      if (stage.avatar) disposeAvatar(stage.avatar);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.avatar) {
      stage.scene.remove(stage.avatar);
      disposeAvatar(stage.avatar);
    }
    const avatar = buildExplorerAvatar({ name, suitColor: look.suitColor, face: look.face, outfit: look.outfit });
    // The floating name tag is for other players; here it only crowds the hat.
    avatar.children.filter((c) => c instanceof THREE.Sprite).forEach((c) => {
      avatar.remove(c);
      disposeAvatar(c);
    });
    avatar.rotation.y = stage.yaw;
    stage.scene.add(avatar);
    stage.avatar = avatar;
  }, [name, look]);

  const lastX = useRef(0);
  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-64 md:h-[22rem] touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          lastX.current = e.clientX;
          if (stageRef.current) stageRef.current.dragging = true;
        }}
        onPointerMove={(e) => {
          const stage = stageRef.current;
          if (!stage?.dragging) return;
          stage.yaw += (e.clientX - lastX.current) * 0.012;
          lastX.current = e.clientX;
        }}
        onPointerUp={() => { if (stageRef.current) stageRef.current.dragging = false; }}
        onPointerCancel={() => { if (stageRef.current) stageRef.current.dragging = false; }}
      />
      <span className="absolute bottom-1 inset-x-0 text-center text-[10px] text-[#F2E8CF]/40 uppercase tracking-wider pointer-events-none">
        {t("wardrobe.dragHint")}
      </span>
    </div>
  );
};

interface WardrobeModalProps {
  name: string;
  initial: WardrobeLook;
  /** Every change while trying things on (the mirror next to the wardrobe follows it). */
  onPreview: (look: WardrobeLook) => void;
  onSave: (look: WardrobeLook) => void;
  /** Closed without saving: the caller restores `initial`. */
  onCancel: () => void;
}

type Tab = "color" | "face" | "accessories";

/**
 * The lobby wardrobe ("Armário"): suit colour, the helmet face and one
 * accessory per slot, with a live 3D preview. Nothing reaches the rest of the
 * room until "Vestir"; Escape or Cancel puts the old look back.
 */
export const WardrobeModal: React.FC<WardrobeModalProps> = ({ name, initial, onPreview, onSave, onCancel }) => {
  useLanguage();
  const [look, setLook] = useState<WardrobeLook>(initial);
  const [tab, setTab] = useState<Tab>("accessories");

  const update = (patch: Partial<WardrobeLook>) => {
    setLook((prev) => {
      const next = { ...prev, ...patch, outfit: { ...prev.outfit, ...patch.outfit } };
      onPreview(next);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const randomize = () => {
    const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
    const outfit = {} as Outfit;
    for (const slot of OUTFIT_SLOTS) outfit[slot] = Math.random() < 0.25 ? "" : pick(OUTFIT_ITEMS[slot]);
    update({ suitColor: pick(SUIT_COLORS), outfit });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "color", label: t("wardrobe.tab.color") },
    { id: "face", label: t("wardrobe.tab.face") },
    { id: "accessories", label: t("wardrobe.tab.accessories") },
  ];

  const chip = (selected: boolean) =>
    `px-2.5 py-1.5 rounded border text-[11px] uppercase tracking-wider transition-all cursor-pointer ${
      selected ? "border-[#deb81d] bg-[#deb81d]/15 text-[#deb81d]" : "border-white/10 text-[#F2E8CF]/70 hover:border-white/40 hover:text-white"
    }`;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm font-mono px-4">
      <div className="w-full max-w-3xl max-h-[94vh] overflow-y-auto bg-[#14130a] border border-[#a28e3b]/40 rounded-lg p-5 md:p-7 shadow-[0_0_60px_rgba(0,0,0,0.9)] relative">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[#deb81d] opacity-40 rounded-t-lg" />
        <button type="button" onClick={onCancel} aria-label={t("wardrobe.cancel")} className="absolute top-4 right-4 text-[#F2E8CF]/50 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-[#F2E8CF] flex items-center gap-2 border-b border-white/10 pb-3 uppercase tracking-wider">
          <Shirt className="w-5 h-5 text-[#deb81d]" />
          {t("wardrobe.title")}
        </h2>
        <p className="text-[11px] text-[#F2E8CF]/50 mt-3 leading-relaxed uppercase tracking-wider">{t("wardrobe.hint")}</p>

        <div className="mt-4 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-5">
          <div className="rounded border border-white/10 bg-gradient-to-b from-[#2a2614] to-[#0d0c06]">
            <LookPreview name={name} look={look} />
          </div>

          <div className="min-w-0">
            <div className="flex gap-1 border-b border-white/10">
              {tabs.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => setTab(tb.id)}
                  className={`px-3 py-2 text-[11px] uppercase tracking-wider border-b-2 -mb-px cursor-pointer ${
                    tab === tb.id ? "border-[#deb81d] text-[#deb81d]" : "border-transparent text-[#F2E8CF]/50 hover:text-white"
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>

            {tab === "color" && (
              <div className="grid grid-cols-4 gap-3 mt-4">
                {SUIT_COLORS.map((color) => {
                  const selected = look.suitColor === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      aria-label={t("menu.colorLabel", { color })}
                      onClick={() => update({ suitColor: color })}
                      className={`aspect-square rounded border-2 transition-all cursor-pointer ${
                        selected ? "border-[#deb81d] scale-105 shadow-[0_0_14px_rgba(222,184,29,0.4)]" : "border-white/10 hover:border-white/40"
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {selected && <Check className="w-4 h-4 text-white mx-auto drop-shadow-[0_0_2px_#000]" />}
                    </button>
                  );
                })}
              </div>
            )}

            {tab === "face" && (
              <div className="-mt-2">
                <FaceEditor face={look.face} suitColor={look.suitColor} onChange={(face) => update({ face })} />
              </div>
            )}

            {tab === "accessories" && (
              <div className="mt-3 space-y-4">
                {OUTFIT_SLOTS.map((slot: OutfitSlot) => (
                  <div key={slot}>
                    <div className="text-[11px] text-[#F2E8CF]/50 uppercase tracking-wider mb-1.5">{t(`wardrobe.slot.${slot}`)}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className={chip(look.outfit[slot] === "")} onClick={() => update({ outfit: { [slot]: "" } as Partial<Outfit> as Outfit })}>
                        {t("wardrobe.none")}
                      </button>
                      {OUTFIT_ITEMS[slot].map((id) => (
                        <button key={id} type="button" className={chip(look.outfit[slot] === id)} onClick={() => update({ outfit: { [slot]: id } as Partial<Outfit> as Outfit })}>
                          {t(`wardrobe.item.${id}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-6">
          <button
            type="button"
            onClick={randomize}
            className="flex items-center gap-2 px-4 py-2.5 rounded border border-white/15 text-[#F2E8CF]/80 hover:text-white hover:border-white/40 text-xs uppercase tracking-wider cursor-pointer"
          >
            <Shuffle className="w-4 h-4" /> {t("wardrobe.random")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded border border-white/15 text-[#F2E8CF]/70 hover:text-white text-xs uppercase tracking-wider cursor-pointer"
          >
            {t("wardrobe.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onSave(look)}
            className="px-5 py-2.5 rounded bg-[#deb81d] text-black font-bold hover:bg-[#f0cc35] text-xs uppercase tracking-wider cursor-pointer"
          >
            {t("wardrobe.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

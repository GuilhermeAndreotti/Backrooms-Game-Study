import { useEffect, useRef, useState } from "react";
import { t, useLanguage } from "../i18n";
import type { HotelPanel } from "../game/levels/hotelDirector";
import type { HotelAction, Pressure } from "../shared/hotel";

export interface HotelPanelInfo {
  /** Reception code as the room has found it ("I ♠ 7 · II ♦ ? ..."). */
  hint: string | null;
  /** The valve's gauge reading and current setting (valve panels only). */
  valve: { psi: number; setting: Pressure | null } | null;
}

const SETTINGS = ["LOW", "MEDIUM", "HIGH"] as const;

export function HotelPanelModal({ panel, feedback, info, onSubmit, onClose }: {
  panel: HotelPanel; feedback: "idle" | "pending" | "accepted" | "denied";
  /** Polled while open: a teammate can find a card or turn a valve meanwhile. */
  info(): HotelPanelInfo;
  onSubmit(action: HotelAction): void; onClose(): void;
}) {
  useLanguage();
  const [code, setCode] = useState("");
  const [live, setLive] = useState(info);
  const [setting, setSetting] = useState<Pressure>(() => info().valve?.setting ?? 0);
  const infoRef = useRef(info); infoRef.current = info;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const timer = setInterval(() => setLive(infoRef.current()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // E closes too (a key press is a user gesture, so the game can re-take the
    // mouse), but only once the E that opened the panel has been released.
    let armed = false;
    const down = (e: KeyboardEvent) => {
      const isE = e.key === "e" || e.key === "E";
      if (e.key !== "Escape" && !isE) return;
      // Consumed here so App's handler can't reopen the panel on the same press.
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat || isE && !armed) return;
      close.current();
    };
    const up = (e: KeyboardEvent) => { if (e.key === "e" || e.key === "E") armed = true; };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
  }, []);
  const valve = panel.kind === "valve" ? live.valve : null;
  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <form className="w-full max-w-sm border-2 border-[#aa854d] bg-[#241611] p-6 text-[#e4c98f] shadow-2xl" onSubmit={e => {
      e.preventDefault();
      onSubmit(panel.kind === "code" ? { kind: "code", code } : { kind: "valve", index: panel.index, setting });
    }}>
      <h2 className="text-xl font-serif">{panel.kind === "code" ? t("hotel.codeTitle") : t("hotel.valveTitle", { valve: "ABC"[panel.index] })}</h2>
      {panel.kind === "code" ? <>
        {live.hint && <div className="mt-4 border border-[#aa854d]/50 bg-black/30 p-2 text-sm">
          <div className="text-[11px] uppercase tracking-wider text-[#e4c98f]/70">{t("hotel.codeKnown")}</div>
          <div className="mt-1 font-serif text-lg tracking-wider">{live.hint}</div>
        </div>}
        <label className="mt-5 block text-sm">{t("hotel.codeLabel")}
          <input autoFocus inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} className="mt-2 w-full border border-[#aa854d] bg-black/50 p-3 text-center text-3xl tracking-[0.4em]" />
        </label>
      </> : <>
        {valve && <div className="mt-4 border border-[#aa854d]/50 bg-black/30 p-2 text-sm">
          <div className="font-serif text-lg">{t("hotel.valveGauge", { psi: valve.psi })}</div>
          <div className="mt-1 text-xs text-[#e4c98f]/80">{t("hotel.valveChart")}</div>
          <div className="mt-1 text-xs text-[#e4c98f]/80">{t("hotel.valveCurrent", { setting: valve.setting === null ? t("hotel.valveUnset") : SETTINGS[valve.setting] })}</div>
        </div>}
        <div className="my-6 flex gap-2">
          {SETTINGS.map((label, i) => <button key={label} type="button" aria-pressed={setting === i} onClick={() => setSetting(i as Pressure)} className={`flex-1 border p-3 ${setting === i ? "bg-[#aa854d] text-black" : "border-[#aa854d]"}`}>{label}</button>)}
        </div>
      </>}
      <p aria-live="polite" className="my-3 min-h-10 text-sm">{feedback !== "idle" ? t(`hotel.${feedback}`) : ""}</p>
      <button disabled={feedback === "pending" || panel.kind === "code" && code.length !== 4 || panel.kind === "valve" && valve?.setting === setting} className="w-full bg-[#aa854d] p-3 font-bold text-black disabled:opacity-40">{t("hotel.confirm")}</button>
      <button type="button" onClick={onClose} className="mt-3 w-full p-2">{t("hotel.close")}</button>
    </form>
  </div>;
}

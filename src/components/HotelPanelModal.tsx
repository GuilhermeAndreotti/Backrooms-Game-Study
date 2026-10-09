import { useEffect, useRef, useState } from "react";
import { t, useLanguage } from "../i18n";
import type { HotelPanel } from "../game/levels/hotelDirector";
import type { HotelAction, Pressure } from "../shared/hotel";

export function HotelPanelModal({ panel, feedback, onSubmit, onClose }: {
  panel: HotelPanel; feedback: "idle" | "pending" | "accepted" | "denied";
  onSubmit(action: HotelAction): void; onClose(): void;
}) {
  useLanguage();
  const [code, setCode] = useState("");
  const [setting, setSetting] = useState<Pressure>(0);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); close.current(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <form className="w-full max-w-sm border-2 border-[#aa854d] bg-[#241611] p-6 text-[#e4c98f] shadow-2xl" onSubmit={e => {
      e.preventDefault();
      onSubmit(panel.kind === "code" ? { kind: "code", code } : { kind: "valve", index: panel.index, setting });
    }}>
      <h2 className="text-xl font-serif">{panel.kind === "code" ? t("hotel.codeTitle") : `VALVE ${"ABC"[panel.index]} · PRESSURE`}</h2>
      {panel.kind === "code" ? <label className="mt-5 block text-sm">{t("hotel.codeLabel")}
        <input autoFocus inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} className="mt-2 w-full border border-[#aa854d] bg-black/50 p-3 text-center text-3xl tracking-[0.4em]" />
      </label> : <div className="my-6 flex gap-2">
        {(["LOW", "MEDIUM", "HIGH"] as const).map((label, i) => <button key={label} type="button" aria-pressed={setting === i} onClick={() => setSetting(i as Pressure)} className={`flex-1 border p-3 ${setting === i ? "bg-[#aa854d] text-black" : "border-[#aa854d]"}`}>{label}</button>)}
      </div>}
      <p aria-live="polite" className="my-3 min-h-10 text-sm">{feedback !== "idle" ? t(`hotel.${feedback}`) : ""}</p>
      <button disabled={feedback === "pending" || panel.kind === "code" && code.length !== 4} className="w-full bg-[#aa854d] p-3 font-bold text-black disabled:opacity-40">{t("hotel.confirm")}</button>
      <button type="button" onClick={onClose} className="mt-3 w-full p-2">{t("term.close")} · ESC</button>
    </form>
  </div>;
}

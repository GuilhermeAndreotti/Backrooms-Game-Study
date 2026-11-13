import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { fromFen, needsPromotion, squareName, type Color, type Promotion } from "../shared/chess";
import {
  CARDS, CARD_IDS, POWER, PowerChessGame,
  type CardId, type CardPlay, type PowerChessNetState, type PowerLogEntry, type Rarity,
} from "../shared/powerChess";
import { t } from "../i18n";
import { ChessBoardGrid, GLYPH, pieceStyle } from "./ChessBoardGrid";
import { ChessPiece } from "./ChessPiece";
import { PowerCardImpact, PowerCardSurge } from "./PowerCardImpact";
import { favoriteCard, loadPowerChessStats } from "../utils/powerChessStats";

interface PowerChessModalProps {
  state: PowerChessNetState;
  myId: string;
  send: (message: Record<string, unknown>) => void;
  onClose: () => void;
}

export const CARD_ICON: Record<CardId, string> = {
  almond: "💧", sanity: "📜", noclip: "👻", tape: "🛡️", wetfloor: "⚠️", flicker: "💡", mirror: "🪞",
  door: "🚪", gust: "💨", blackout: "🌑", ascend: "⬆️", exit: "🏃", smiler: "😁", adrenaline: "💉", memory: "🕯️",
};

const RARITY: Record<Rarity, { border: string; glow: string; text: string }> = {
  common: { border: "#8c8270", glow: "rgba(140,130,112,0.25)", text: "#d6cbb0" },
  uncommon: { border: "#4aa3df", glow: "rgba(74,163,223,0.35)", text: "#9fd3ff" },
  rare: { border: "#c58aff", glow: "rgba(197,138,255,0.5)", text: "#e2c6ff" },
};

const cardName = (id: CardId) => t(`pchess.card.${id}.name`);
const cardDesc = (id: CardId) => t(`pchess.card.${id}.desc`);

function CardFace({ id, onClick, disabled, active, small, reason }: { key?: string; id: CardId; onClick?: () => void; disabled?: boolean; active?: boolean; small?: boolean; reason?: string }) {
  const [details, setDetails] = useState(false);
  const infoButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!details) return;
    closeButton.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key.toLowerCase() === "e") {
        event.stopImmediatePropagation(); setDetails(false); infoButton.current?.focus();
      }
      if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); }
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [details]);
  const def = CARDS[id];
  const r = RARITY[def.rarity];
  return (
    <div
      title={`${cardName(id)} — ${reason || cardDesc(id)}`}
      className={`relative flex shrink-0 flex-col items-center rounded-xl border bg-gradient-to-b from-[#30243f] to-[#100d18] text-center transition-all duration-200 ${small ? "w-20 p-1" : "w-32 p-2"} ${onClick && !disabled ? "hover:-translate-y-2 hover:rotate-1 cursor-pointer" : "cursor-default"} ${disabled ? "opacity-60 saturate-50" : ""} ${active ? "-translate-y-3 ring-2 ring-amber-200/40" : ""}`}
      style={{ borderColor: active ? "#ffd95a" : r.border, boxShadow: `0 0 ${active ? 22 : 12}px ${active ? "rgba(255,217,90,0.6)" : r.glow}` }}
    >
      <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-[#ffd95a] bg-[#2a2008] text-xs font-bold text-[#ffd95a]">{def.cost}</span>
      <button ref={infoButton} type="button" aria-label={`${t("pchess.help")}: ${cardName(id)}`} aria-expanded={details} onClick={() => setDetails(true)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-violet-300/60 bg-[#191323] text-sm text-violet-100 hover:bg-violet-800">?</button>
      <span className={small ? "text-2xl" : "text-3xl"}>{CARD_ICON[id]}</span>
      <span className="mt-1 text-[0.65rem] font-bold uppercase leading-tight tracking-wide" style={{ color: r.text }}>{cardName(id)}</span>
      {!small && <span className="mt-2 text-[0.65rem] leading-snug text-stone-300">{cardDesc(id)}</span>}
      {def.endsTurn && !small && <span className="mt-1 text-[0.55rem] uppercase tracking-widest text-red-300">{t("pchess.endsTurn")}</span>}
      {reason && <span className="mt-2 text-[0.6rem] text-amber-200">{reason}</span>}
      {onClick && <button type="button" onClick={onClick} disabled={disabled} className="mt-auto w-full rounded-md border border-violet-300/50 bg-violet-500/20 px-2 py-1.5 text-xs font-bold text-violet-100 hover:bg-violet-500/40 disabled:cursor-not-allowed disabled:opacity-40">{t("pchess.use")}</button>}
      {details && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 font-mono backdrop-blur-sm" onClick={() => { setDetails(false); infoButton.current?.focus(); }}>
        <div role="dialog" aria-modal="true" aria-label={cardName(id)} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-violet-300/60 bg-[#191323] p-6 text-sm text-stone-200 shadow-[0_0_80px_#8b5cf644]">
          <div className="mb-4 text-xl font-bold text-violet-200">{CARD_ICON[id]} {cardName(id)}</div>
          <p className="mb-3 font-bold text-cyan-200">{t("pchess.cardCost", { n: def.cost })}</p>
          <p className="mb-3 leading-relaxed">{t(`pchess.card.${id}.detail`)}</p>
          <p className={`mb-3 font-bold ${def.endsTurn ? "text-red-300" : "text-emerald-300"}`}>{t(def.endsTurn ? "pchess.endsTurn" : "pchess.keepsTurn")}</p>
          <p className="text-xs leading-relaxed text-stone-400">{t("pchess.cardRestrictions")}</p>
          <button ref={closeButton} onClick={() => { setDetails(false); infoButton.current?.focus(); }} className="mt-5 rounded border border-violet-400 px-4 py-2 text-violet-100">{t("chess.close")}</button>
        </div>
      </div>, document.body)}
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <span className="relative inline-flex normal-case tracking-normal">
    <button type="button" aria-label={t("pchess.help")} aria-expanded={open} onClick={() => setOpen(!open)} className="ml-2 flex h-5 w-5 items-center justify-center rounded-full border border-violet-300/40 text-xs text-violet-200">?</button>
    {open && <span role="note" className="absolute right-0 top-7 z-40 w-64 rounded-lg border border-violet-400/40 bg-[#191323] p-3 text-left text-xs leading-relaxed text-stone-200 shadow-xl">{text}</span>}
  </span>;
}

function EnergyBar({ value }: { value: number }) {
  return (
    <div className="flex gap-[2px]" title={t("pchess.energy")}>
      {Array.from({ length: POWER.maxEnergy }, (_, i) => (
        <span key={i} className={`h-2.5 w-2 ${i < value ? "bg-[#5fd4ff] shadow-[0_0_6px_#5fd4ff]" : "bg-stone-800"}`} />
      ))}
    </div>
  );
}

/** The power-chess table: sit, play cards, move, or watch. The server decides everything; this rebuilds the game only to highlight. */
export function PowerChessModal({ state, myId, send, onClose }: PowerChessModalProps) {
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const inflight = useRef(false);
  const logBox = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
  /** Card being aimed: hand slot and the squares picked so far. */
  const [aiming, setAiming] = useState<{ index: number; picked: number[] } | null>(null);
  /** Ascensão: squares chosen, waiting for knight/bishop. */
  const [choosing, setChoosing] = useState<{ index: number; targets: number[] } | null>(null);
  const [help, setHelp] = useState(false);
  const [flash, setFlash] = useState<{ c: Color; card: CardId; key: number } | null>(null);
  const [stats, setStats] = useState(loadPowerChessStats);

  const pos = useMemo(() => fromFen(state.fen), [state.fen]);
  const seat: Color | null = state.white === myId ? "w" : state.black === myId ? "b" : null;
  const playing = state.status === "playing";
  const myTurn = playing && seat === pos.turn;
  const interactive = myTurn && !busy && !pending && !choosing;
  const flipped = seat === "b";
  const game = useMemo(() => PowerChessGame.fromNet(state, seat), [state, seat]);
  const moves = useMemo(() => (myTurn ? game.moves() : []), [game, myTurn]);
  const canCard = myTurn && game.canPlayCards(seat!);
  const plays = useMemo<CardPlay[][]>(() => (canCard ? state.hand.map((_, i) => game.cardPlays(seat!, i)) : []), [game, canCard, seat, state.hand]);
  const inCheckNow = playing && game.inCheck(pos.turn);
  const checked = inCheckNow ? pos.board.findIndex((p) => p?.c === pos.turn && p.t === "k") : -1;
  const targets = useMemo(() => new Set(selected !== null ? moves.filter((m) => m.from === selected).map((m) => m.to) : []), [moves, selected]);

  /** Squares the aimed card can pick next. */
  const aimSquares = useMemo(() => {
    if (!aiming) return new Set<number>();
    const k = aiming.picked.length;
    const next = (plays[aiming.index] ?? []).filter((p) => aiming.picked.every((sq, i) => p.targets[i] === sq)).map((p) => p.targets[k]);
    return new Set(next.filter((sq) => sq !== undefined));
  }, [aiming, plays]);

  // Anything half-picked is dropped when the table changes.
  useEffect(() => { setSelected(null); setPending(null); setAiming(null); setChoosing(null); setBusy(false); setConnectionIssue(false); inflight.current = false; }, [state]);
  useEffect(() => { if (followLog.current && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight; }, [state.log.length, state.game]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setConnectionIssue(true);
      try { sendRef.current({ type: "pchess_sync" }); } catch { /* Keep the board locked until an authoritative frame arrives. */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [busy]);
  const submit = (message: Record<string, unknown>) => {
    if (inflight.current || !myTurn) return;
    inflight.current = true; setBusy(true);
    try { send({ ...message, rev: state.rev, game: state.game }); }
    catch { setConnectionIssue(true); }
  };

  // A card was just played (by anyone): flash it across the panel.
  const seenSeq = useRef(state.lastCard ? `${state.game}:${state.lastCard.seq}` : "");
  useEffect(() => {
    const lc = state.lastCard;
    if (!lc) { setFlash(null); seenSeq.current = ""; return; }
    const key = `${state.game}:${lc.seq}`;
    if (key === seenSeq.current) return;
    seenSeq.current = key;
    setFlash({ c: lc.c, card: lc.card, key: lc.seq });
  }, [state.lastCard?.seq, state.game]);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(id);
  }, [flash]);

  useEffect(() => { if (state.status === "over") setStats(loadPowerChessStats()); }, [state.status, state.rev]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key.toLowerCase() === "e") {
        if (help) setHelp(false);
        else if (choosing) setChoosing(null);
        else if (aiming) setAiming(null);
        else if (pending) setPending(null);
        else if (selected !== null) setSelected(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending, selected, aiming, choosing, help]);

  const playCard = (index: number, targetsPicked: number[], choice?: "n" | "b") => {
    submit({ type: "pchess_card", index, targets: targetsPicked, choice });
    setAiming(null);
    setChoosing(null);
  };

  const pickCard = (index: number) => {
    if (!interactive || !canCard || !(plays[index]?.length)) return;
    if (aiming?.index === index) { setAiming(null); return; }
    setSelected(null);
    const id = state.hand[index];
    const need = id === "exit" ? 1 : CARDS[id].steps;
    if (need === 0) playCard(index, []);
    else setAiming({ index, picked: [] });
  };

  const click = (sq: number) => {
    if (!interactive) return;
    if (aiming) {
      if (!aimSquares.has(sq)) return;
      const picked = [...aiming.picked, sq];
      const id = state.hand[aiming.index];
      const need = id === "exit" ? 1 : CARDS[id].steps;
      if (picked.length < need) { setAiming({ ...aiming, picked }); return; }
      if (CARDS[id].choices) { setChoosing({ index: aiming.index, targets: picked }); setAiming(null); return; }
      playCard(aiming.index, picked);
      return;
    }
    const piece = pos.board[sq];
    if (selected !== null && targets.has(sq)) {
      if (needsPromotion(pos, selected, sq)) setPending({ from: selected, to: sq });
      else submit({ type: "pchess_move", from: selected, to: sq });
      return;
    }
    setSelected(piece && piece.c === pos.turn && sq !== selected ? sq : null);
  };
  const drop = (from: number, to: number) => {
    if (!interactive || aiming || !moves.some(m => m.from === from && m.to === to)) return;
    if (needsPromotion(pos, from, to)) setPending({ from, to });
    else submit({ type: "pchess_move", from, to });
  };

  // --- effects on squares ---------------------------------------------------
  const fxAt = useMemo(() => new Map(state.fx.map((f) => [f[0], f])), [state.fx]);
  const wallAt = useMemo(() => new Map(state.walls.filter(([, until]) => until >= state.ply)), [state.walls, state.ply]);
  const frozen = (sq: number) => { const f = fxAt.get(sq); return !!f && f[1] >= state.ply; };
  const shielded = (sq: number) => { const f = fxAt.get(sq); return !!f && f[2] >= state.ply; };
  const ghost = (sq: number) => !!fxAt.get(sq)?.[4];
  /** Turns left on an effect that lasts through ply `until`, counted in the owner's turns. */
  const turnsLeft = (until: number) => Math.max(1, Math.ceil((until - state.ply + 1) / 2));

  const under = (sq: number) => (
    <>
      {wallAt.has(sq) && (
        <span className="absolute inset-0 flex items-center justify-center bg-[#0f2233]/90 text-[0.9em]" title={t("pchess.fx.wall", { n: turnsLeft(wallAt.get(sq)!) })}>⚠️</span>
      )}
      {frozen(sq) && <span className="absolute inset-0 bg-[#7fd8ff]/45 shadow-[inset_0_0_14px_#dff6ff]" />}
      {shielded(sq) && <span className="absolute inset-[6%] rounded-full border-4 border-[#ffd23a]/90 shadow-[0_0_10px_#ffd23a]" />}
    </>
  );
  const over = (sq: number) => (
    <>
      {(frozen(sq) || ghost(sq)) && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 text-[0.32em]">{frozen(sq) ? "❄️" : "👻"}</span>
      )}
      {aimSquares.has(sq) && <span className="absolute inset-[3px] motion-safe:animate-pulse rounded-sm border-[3px] border-[#c58aff] bg-[#c58aff]/25" />}
      {aiming?.picked.includes(sq) && <span className="absolute inset-0 bg-[#c58aff]/50" />}
      {flash && state.lastCard?.sq.includes(sq) && <PowerCardImpact key={`${state.game}-${flash.key}`} card={flash.card} />}
    </>
  );

  // --- text -------------------------------------------------------------------
  const result = state.result;
  const anomalous = result?.reason === "checkmate" && !!result.card;
  const reasonText = (r: NonNullable<typeof result>["reason"]) => (r === "turns" ? t("pchess.reason.turns") : t(`chess.reason.${r}`));
  const status = (() => {
    if (state.status === "waiting") return t(seat ? "chess.hint.waitOpponent" : "chess.hint.waiting");
    if (state.status === "over" && result) {
      const who = result.winner === "w" ? t("chess.result.w") : result.winner === "b" ? t("chess.result.b") : t("chess.result.draw");
      return `${who} · ${reasonText(result.reason)}`;
    }
    const turn = pos.turn === seat ? t("chess.yourTurn") : t("pchess.opponentTurn", { name: (pos.turn === "w" ? state.whiteName : state.blackName) || t(pos.turn === "w" ? "chess.turn.w" : "chess.turn.b") });
    let s = inCheckNow ? `${turn} · ${t("chess.check")}` : turn;
    if (myTurn && state.extra >= 0) s += ` · ${t("pchess.extraMove")}`;
    else if (myTurn && state.adrenaline) s += ` · ${t("pchess.adrenaline")}`;
    else if (myTurn && !moves.length) s += ` · ${t("pchess.onlyCards")}`;
    return s;
  })();
  const aimHint = aiming
    ? (state.hand[aiming.index] === "door" || state.hand[aiming.index] === "mirror") && aiming.picked.length === 1
      ? t("pchess.pickSecond")
      : t("pchess.pickTarget", { card: cardName(state.hand[aiming.index]) })
    : null;

  const logLine = (e: PowerLogEntry, i: number) => (
    <div key={i} className="flex items-start justify-between gap-1.5 py-1" title={e.card ? cardDesc(e.card) : undefined}>
      {e.card
        ? <span className="text-[#d9c2ff]">{CARD_ICON[e.card]} {cardName(e.card)}{e.sq?.length ? ` ${e.sq.filter((sq) => sq >= 0).map(squareName).join("→")}` : ""}{e.choice ? ` (${GLYPH[e.choice]})` : ""}</span>
         : <span>{e.san}</span>}
      <span className="shrink-0 text-[10px] tabular-nums text-stone-500">{(e.elapsedMs / 1000).toFixed(1)}s</span>
    </div>
  );
  const logRows = useMemo(() => {
    const rows = new Map<number, { w: PowerLogEntry[]; b: PowerLogEntry[] }>();
    for (const entry of state.log) {
      const n = Math.floor(entry.ply / 2) + 1;
      if (!rows.has(n)) rows.set(n, { w: [], b: [] });
      rows.get(n)![entry.c].push(entry);
    }
    return [...rows];
  }, [state.log]);

  const seatRow = (color: Color) => {
    const id = color === "w" ? state.white : state.black;
    const name = color === "w" ? state.whiteName : state.blackName;
    const turnNow = playing && pos.turn === color;
    return (
      <div className={`flex flex-col gap-1 rounded-lg border px-3 py-2 transition-colors duration-300 ${turnNow ? "border-[#c58aff] bg-[#281b3c] shadow-[0_0_20px_#a855f720]" : "border-stone-700 bg-black/30"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`inline-block h-4 w-4 shrink-0 rounded-full border ${color === "w" ? "border-stone-400 bg-[#f2e8d0]" : "border-stone-500 bg-[#1f1814]"}`} />
            <span className="truncate text-sm text-stone-100">
              {id ? name || "?" : <span className="text-stone-500">{t("chess.free")}</span>}
              {id === myId && <span className="ml-1 text-xs text-[#ffd95a]">{t("chess.you")}</span>}
              {turnNow && <span className="ml-2 text-xs text-violet-300">▶ {t(color === seat ? "chess.yourTurn" : color === "w" ? "chess.turn.w" : "chess.turn.b")}</span>}
            </span>
          </div>
          {!id && !seat && (
            <button onClick={() => send({ type: "pchess_sit", color })} className="border border-[#c58aff] px-2 py-0.5 text-xs text-[#e2c6ff] hover:bg-[#2a1840]">{t("chess.sit")}</button>
          )}
          {!id && seat && seat !== color && (
            <button onClick={() => send({ type: "pchess_sit", color })} className="border border-stone-600 px-2 py-0.5 text-xs text-stone-300 hover:border-[#c58aff]">{t("chess.switch")}</button>
          )}
          {id === myId && (
            <button onClick={() => send({ type: "pchess_stand" })} className="border border-stone-600 px-2 py-0.5 text-xs text-stone-300 hover:border-red-700 hover:text-red-300">{t("chess.stand")}</button>
          )}
        </div>
        {state.status !== "waiting" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-stone-400">
            <span className="flex items-center gap-1"><span className="text-[#5fd4ff]">⚡{state.energy[color]}</span><EnergyBar value={state.energy[color]} /><HelpTip text={`${t("pchess.rules.energy")} ${t("pchess.rules.comeback")}`} /></span>
            <span title={t("pchess.hand")}>🂠 {state.handCount[color]}</span>
            <span title={t("pchess.deck")}>🗃 {state.deckCount[color]}</span>
            {state.lost[color].length > 0 && (
              <span className="text-sm leading-none" title={t("pchess.lost")} style={pieceStyle(color)}>{state.lost[color].map((p) => GLYPH[p]).join("")}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const fav = favoriteCard(stats);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 font-mono backdrop-blur-sm">
      <div role="dialog" aria-label={t("pchess.title")} className="relative my-auto flex w-full max-w-6xl shrink-0 flex-col gap-3 rounded-2xl border border-[#7a4ac9]/60 bg-gradient-to-br from-[#20172d] via-[#100d18] to-[#171222] p-4 shadow-[0_24px_100px_#000a]">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="relative w-full md:w-auto md:flex-1">
            <div className="mx-auto mb-2 max-w-[560px]">{seatRow(flipped ? "w" : "b")}</div>
            <ChessBoardGrid
              key={state.game}
              pieceIds={state.pieceIds}
              animationKind={state.log.at(-1)?.card}
              onMove={drop}
              canDrag={(sq) => !aiming && moves.some(m => m.from === sq)}
              pos={pos}
              flipped={flipped}
              clickable={interactive}
              onSquare={click}
              selected={selected}
              targets={targets}
              last={state.last}
              checked={checked}
              promoting={pending ? seat : null}
              onPromote={(p: Promotion) => { if (pending) submit({ type: "pchess_move", from: pending.from, to: pending.to, promo: p }); setPending(null); }}
              colors={["#d8d2a8", "#5b4a7a"]}
              frame="#1d1630"
              under={under}
              over={over}
              pieceExtra={(sq) => (ghost(sq) ? { opacity: 0.5, filter: "drop-shadow(0 0 6px #b58aff)" } : undefined)}
            />
            <div className="mx-auto mt-2 max-w-[560px]">{seatRow(flipped ? "b" : "w")}</div>
            {flash && <PowerCardSurge key={`${state.game}-${flash.key}`} card={flash.card} />}
            {choosing && (
              <div role="dialog" aria-label={t("pchess.ascendTo")} className="absolute inset-0 z-40 flex items-center justify-center rounded-lg bg-black/75 backdrop-blur-sm">
                <div className="border-2 border-[#c58aff] bg-[#140c20] p-3">
                  <div className="mb-2 text-center text-xs tracking-widest text-[#e2c6ff]">{t("pchess.ascendTo")}</div>
                  <div className="flex gap-2">
                    {(["n", "b"] as const).map((p) => (
                      <button key={p} disabled={!plays[choosing.index]?.some(play => play.choice === p && play.targets.every((sq, i) => sq === choosing.targets[i]))} onClick={() => playCard(choosing.index, choosing.targets, p)} className="h-16 w-16 border border-stone-600 bg-[#d8d2a8] text-5xl hover:border-[#c58aff] disabled:opacity-30" style={pieceStyle(seat ?? "w")}>
                        <ChessPiece color={seat ?? "w"} type={p} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {state.status === "over" && anomalous && (
              <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
                <div className="border-y-2 border-[#ff5ad1] bg-black/80 px-8 py-3 text-center">
                  <div className="text-2xl font-black tracking-[0.35em] text-[#ff8ae0] drop-shadow-[0_0_12px_#ff5ad1]">{t("pchess.anomalousMate")}</div>
                  <div className="mt-1 text-xs text-stone-300">{CARD_ICON[result!.card!]} {cardName(result!.card!)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2 md:w-[22rem]">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#7a4ac9] to-[#3a1e6a] px-3 py-1">
              <span className="text-sm font-bold tracking-[0.3em] text-white">{t("pchess.title")}</span>
              <button onClick={() => setHelp(true)} className="h-6 w-6 rounded-full border border-white/60 text-xs text-white hover:bg-white/20" title={t("pchess.help")}>?</button>
            </div>
            <div role="status" aria-live="polite" className={`rounded-xl border px-4 py-4 text-base font-bold ${state.status === "over" ? "border-green-700 text-green-300" : myTurn ? "border-[#c58aff] bg-violet-500/15 text-[#e2c6ff]" : "border-stone-700 text-stone-300"}`}>
              {busy ? t("pchess.busy") : status}<HelpTip text={t("pchess.turnHelp")} />
              {myTurn && !aiming && <div className="mt-2 text-xs font-normal text-stone-400">{t("pchess.drag")}</div>}
              {aimHint && <div className="mt-1 text-xs text-[#ffd95a]">{aimHint} <button className="ml-2 underline" onClick={() => setAiming(null)}>{t("pchess.cancel")}</button></div>}
            </div>
            {state.error && <div role="alert" className="rounded border border-amber-600/50 p-2 text-xs text-amber-200">{t("pchess.error")}</div>}
            {connectionIssue && <div role="alert" className="rounded border border-amber-600/50 p-2 text-xs text-amber-200">{t("pchess.connectionIssue")}</div>}
            <AnimatePresence mode="wait">
              {state.lastCard && <motion.div key={`${state.game}-${state.lastCard.seq}`} initial={{ opacity: 0, x: reduced ? 0 : 35, scale: reduced ? 1 : .95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0 }} className={`rounded-xl border p-3 ${flash ? "border-fuchsia-400 bg-fuchsia-500/15" : "border-violet-800/50 bg-black/20"}`} role="status">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">{state.lastCard.c === "w" ? state.whiteName : state.blackName} · {t(state.lastCard.c === "w" ? "pchess.played.w" : "pchess.played.b")}</div>
                <div className="my-1 font-bold text-violet-200">{CARD_ICON[state.lastCard.card]} {cardName(state.lastCard.card)}</div>
                <p className="text-xs leading-relaxed text-stone-300">{cardDesc(state.lastCard.card)}</p>
                {state.lastCard.energyGained !== undefined && <p className="mt-1 text-xs text-cyan-200">{t("pchess.energyResult", { n: state.lastCard.energyGained })}</p>}
                {state.lastCard.cardsDrawn !== undefined && <p className="mt-1 text-xs text-cyan-200">{t("pchess.drawResult", { n: state.lastCard.cardsDrawn })}</p>}
                {state.lastCard.piece && <span className="inline-block h-9 w-9"><ChessPiece color={state.lastCard.c} type={state.lastCard.piece} /></span>}
                {!!state.lastCard.sq.length && <p className="mt-1 text-xs text-amber-200">{t("pchess.targets", { squares: state.lastCard.sq.map(squareName).join(" → ") })}</p>}
              </motion.div>}
            </AnimatePresence>
            <div className="text-xs text-stone-400">❄️ 🛡️ 👻 ⚠️ <HelpTip text={t("pchess.rules.fx")} /></div>
            {!seat && state.status !== "waiting" && <div className="text-xs text-stone-500">{t("chess.hint.spectate")}</div>}
            <div className="flex items-center text-xs tracking-widest text-stone-400">{t("pchess.log")}<HelpTip text={t("pchess.historyHelp")} /></div>
            <div ref={logBox} onScroll={e => { const el = e.currentTarget; followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 35; }} className="min-h-[5rem] flex-1 overflow-y-auto rounded-lg border border-stone-800 bg-black/30 text-xs text-stone-300" style={{ maxHeight: "18rem" }}>
              <div className="sticky top-0 z-10 grid grid-cols-[2rem_1fr_1fr] bg-[#251c31] p-2 text-[10px]"><span>#</span><span>{t("chess.turn.w")}</span><span>{t("chess.turn.b")}</span></div>
              {!logRows.length && <p className="p-3 text-stone-500">{t("pchess.emptyLog")}</p>}
              {logRows.map(([n, entries]) => <div key={n} className="grid grid-cols-[2rem_1fr_1fr] border-t border-white/5 px-2 odd:bg-white/[.03]">
                <span className="py-2 text-stone-500">{n}.</span>
                {(["w", "b"] as const).map(c => <div key={c} className="min-w-0 px-1">{entries[c].map(logLine)}</div>)}
              </div>)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {playing && seat && (
                  <button onClick={() => send({ type: "pchess_resign" })} className="border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950/50">{t("chess.resign")}</button>
                )}
                {state.status === "over" && seat && state.white && state.black && (
                  <button onClick={() => send({ type: "pchess_new" })} className="border border-[#c58aff] px-3 py-1 text-xs text-[#e2c6ff] hover:bg-[#2a1840]">{t("chess.rematch")}</button>
                )}
              </div>
              <button onClick={onClose} className="text-xs text-stone-400 hover:text-white">{t("chess.close")}</button>
            </div>
            <div className="border-t border-stone-800 pt-1 text-[0.65rem] text-stone-500">
              {t("pchess.stats", { w: stats.wins, l: stats.losses, d: stats.draws })}
              {fav && <> · {t("pchess.favorite", { card: `${CARD_ICON[fav]} ${cardName(fav)}` })}</>}
            </div>
          </div>
        </div>

        {seat && state.status !== "waiting" && (
          <div className="flex flex-col gap-1 border-t border-[#3a1e6a] pt-3">
            <div className="flex items-center justify-between text-[0.65rem] uppercase tracking-widest text-stone-500">
              <span>{t("pchess.yourHand")} ({state.hand.length}/{POWER.maxHand})<HelpTip text={t("pchess.rules.hand")} /></span>
              {myTurn && <span className="text-[#c58aff]">⚡ {state.energy[seat]}/{POWER.maxEnergy}</span>}
            </div>
            <div className="flex gap-3 overflow-x-auto px-2 pb-1 pt-3">
              {state.hand.length === 0 && <span className="text-xs text-stone-600">{t("pchess.noCards")}</span>}
              {state.hand.map((id, i) => {
                const usable = canCard && (plays[i]?.length ?? 0) > 0;
                return (
                  <CardFace
                    key={`${i}-${id}`}
                    id={id}
                    onClick={myTurn ? () => pickCard(i) : undefined}
                     disabled={!interactive || !usable}
                      reason={!myTurn ? undefined : busy ? t("pchess.busy") : seat && state.energy[seat] < CARDS[id].cost ? t("pchess.noEnergy") : !usable ? t("pchess.unavailable") : undefined}
                    active={aiming?.index === i || choosing?.index === i}
                  />
                );
              })}
            </div>
          </div>
        )}

        {help && (
          <div className="absolute inset-0 z-50 overflow-y-auto bg-[#0b0712]/97 p-5 text-sm text-stone-300">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold tracking-[0.3em] text-[#e2c6ff]">{t("pchess.rules.title")}</span>
              <button onClick={() => setHelp(false)} className="text-xs text-stone-400 hover:text-white">{t("chess.close")}</button>
            </div>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-xs">
              {(["energy", "comeback", "hand", "turn", "check", "fx", "end"] as const).map((k) => <li key={k}>{t(`pchess.rules.${k}`)}</li>)}
            </ul>
            <div className="flex flex-wrap gap-3">
              {CARD_IDS.map((id) => <CardFace key={id} id={id} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

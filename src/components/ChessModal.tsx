import { useEffect, useMemo, useState } from "react";
import {
  fromFen, inCheck, legalMovesFrom, needsPromotion,
  type ChessNetState, type Color,
} from "../shared/chess";
import { t } from "../i18n";
import { ChessBoardGrid } from "./ChessBoardGrid";

interface ChessModalProps {
  state: ChessNetState;
  /** This client's player id (to know which seat, if any, is theirs). */
  myId: string;
  send: (message: Record<string, unknown>) => void;
  onClose: () => void;
}

/** The lobby's chess table: sit, play, or watch. The server decides every move; this only shows the board and sends clicks. */
export function ChessModal({ state, myId, send, onClose }: ChessModalProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);

  const pos = useMemo(() => fromFen(state.fen), [state.fen]);
  const mySeat: Color | null = state.white === myId ? "w" : state.black === myId ? "b" : null;
  const playing = state.status === "playing";
  const myTurn = playing && mySeat === pos.turn;
  const flipped = mySeat === "b";
  const checked = playing && inCheck(pos) ? pos.board.findIndex((p) => p?.c === pos.turn && p.t === "k") : -1;
  const targets = useMemo(() => (selected !== null ? legalMovesFrom(pos, selected) : []), [pos, selected]);
  const targetSet = useMemo(() => new Set(targets.map((m) => m.to)), [targets]);

  // A move landed (either side's): nothing stays half-picked.
  useEffect(() => { setSelected(null); setPending(null); }, [state.fen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key.toLowerCase() === "e") {
        if (pending) setPending(null);
        else if (selected !== null) setSelected(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending, selected]);

  const click = (sq: number) => {
    if (!myTurn) return;
    const piece = pos.board[sq];
    if (selected !== null && targetSet.has(sq)) {
      if (needsPromotion(pos, selected, sq)) setPending({ from: selected, to: sq });
      else send({ type: "chess_move", from: selected, to: sq });
      return;
    }
    setSelected(piece && piece.c === pos.turn && sq !== selected ? sq : null);
  };

  const result = state.result;
  const status = (() => {
    if (state.status === "waiting") return t(mySeat ? "chess.hint.waitOpponent" : "chess.hint.waiting");
    if (state.status === "over" && result) {
      const who = result.winner === "w" ? t("chess.result.w") : result.winner === "b" ? t("chess.result.b") : t("chess.result.draw");
      return `${who} · ${t(`chess.reason.${result.reason}`)}`;
    }
    const turn = pos.turn === mySeat ? t("chess.yourTurn") : t(pos.turn === "w" ? "chess.turn.w" : "chess.turn.b");
    return checked >= 0 ? `${turn} · ${t("chess.check")}` : turn;
  })();

  const seatRow = (color: Color) => {
    const id = color === "w" ? state.white : state.black;
    const name = color === "w" ? state.whiteName : state.blackName;
    const turnNow = playing && pos.turn === color;
    return (
      <div className={`flex items-center justify-between gap-2 border px-3 py-2 ${turnNow ? "border-[#ffd95a] bg-[#2a2008]" : "border-stone-700 bg-black/30"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block h-4 w-4 shrink-0 rounded-full border ${color === "w" ? "border-stone-400 bg-[#f2e8d0]" : "border-stone-500 bg-[#1f1814]"}`} />
          <span className="truncate text-sm text-stone-100">
            {id ? name || "?" : <span className="text-stone-500">{t("chess.free")}</span>}
            {id === myId && <span className="ml-1 text-xs text-[#ffd95a]">{t("chess.you")}</span>}
          </span>
        </div>
        {!id && !mySeat && (
          <button onClick={() => send({ type: "chess_sit", color })} className="border border-[#c9962a] px-2 py-0.5 text-xs text-[#f6d36a] hover:bg-[#3a2a08]">{t("chess.sit")}</button>
        )}
        {!id && mySeat && mySeat !== color && (
          <button onClick={() => send({ type: "chess_sit", color })} className="border border-stone-600 px-2 py-0.5 text-xs text-stone-300 hover:border-[#c9962a]">{t("chess.switch")}</button>
        )}
        {id === myId && (
          <button onClick={() => send({ type: "chess_stand" })} className="border border-stone-600 px-2 py-0.5 text-xs text-stone-300 hover:border-red-700 hover:text-red-300">{t("chess.stand")}</button>
        )}
      </div>
    );
  };

  const pairs: string[][] = [];
  state.moves.forEach((m, i) => { if (i % 2 === 0) pairs.push([m]); else pairs[pairs.length - 1].push(m); });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono">
      <div className="flex w-full max-w-4xl flex-col gap-4 border-2 border-[#c9962a] bg-[#140c08]/95 p-4 shadow-[0_0_40px_rgba(201,150,42,0.18)] md:flex-row">
        <ChessBoardGrid
          pos={pos}
          flipped={flipped}
          clickable={myTurn}
          onSquare={click}
          selected={selected}
          targets={targetSet}
          last={state.last}
          checked={checked}
          promoting={pending ? mySeat : null}
          onPromote={(p) => { if (pending) send({ type: "chess_move", from: pending.from, to: pending.to, promo: p }); setPending(null); }}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="bg-[#c9962a] px-3 py-1 text-sm font-bold tracking-[0.3em] text-[#1a0f05]">{t("chess.title")}</div>
          {seatRow(flipped ? "w" : "b")}
          {seatRow(flipped ? "b" : "w")}
          <div className={`border px-3 py-2 text-sm ${state.status === "over" ? "border-green-700 text-green-300" : myTurn ? "border-[#ffd95a] text-[#ffd95a]" : "border-stone-700 text-stone-300"}`}>{status}</div>
          {!mySeat && state.status !== "waiting" && <div className="text-xs text-stone-500">{t("chess.hint.spectate")}</div>}
          <div className="min-h-[5rem] flex-1 overflow-y-auto border border-stone-800 bg-black/30 p-2 text-xs text-stone-300" style={{ maxHeight: "18rem" }}>
            <div className="mb-1 tracking-widest text-stone-500">{t("chess.moves")}</div>
            {pairs.map((p, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr]">
                <span className="text-stone-600">{i + 1}.</span><span>{p[0]}</span><span>{p[1] ?? ""}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {playing && mySeat && (
                <button onClick={() => send({ type: "chess_resign" })} className="border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950/50">{t("chess.resign")}</button>
              )}
              {state.status === "over" && mySeat && state.white && state.black && (
                <button onClick={() => send({ type: "chess_new" })} className="border border-[#c9962a] px-3 py-1 text-xs text-[#f6d36a] hover:bg-[#3a2a08]">{t("chess.rematch")}</button>
              )}
            </div>
            <button onClick={onClose} className="text-xs text-stone-400 hover:text-white">{t("chess.close")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

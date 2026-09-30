/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Zap } from "lucide-react";
import { t, useLanguage, type MessageKey } from "../i18n";
import { ChatMessage, RemotePlayer } from "../types/game";
import { QUICK_CHAT_IDS, type QuickChatId } from "../shared/items";
import { isTypingInField } from "../utils/input";

/** Client-side cap; the server accepts up to 240. */
const MAX_INPUT = 160;
/** While the chat is closed, new messages float above the buttons this long... */
const FEED_MS = 8000;
/** ...and start fading out after this. */
const FEED_FADE_MS = 6000;
const FEED_LINES = 5;
/** The quick-message menu closes itself if nothing is picked. */
const QUICK_MENU_MS = 4000;

/** Number row / numpad digit for e.code, or null. */
function digitOf(code: string): number | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}

interface ChatHUDProps {
  messages: ChatMessage[];
  playerName: string;
  localPlayerId: string | null;
  connectedPlayers: RemotePlayer[];
  onSendMessage: (text: string) => void;
  onSendQuick: (id: QuickChatId) => void;
  /** False while another panel (inventory, terminal...) owns the keyboard: T/Z do nothing. */
  hotkeysEnabled: boolean;
  /** The other HUD buttons (inventory, achievements, mic), rendered next to the chat toggle. */
  children?: React.ReactNode;
}

/**
 * Team chat. T opens it and focuses the input; Enter sends *and closes* (an
 * empty Enter just closes) so the player is moving again the moment the
 * message is out. Esc discards the draft — the browser drops the pointer lock
 * on Esc anyway, so it lands on the pause menu like everywhere else. While
 * closed, new messages fade in and out above the buttons; Z opens canned
 * callouts that need no typing at all.
 */
export const ChatHUD: React.FC<ChatHUDProps> = ({
  messages,
  playerName,
  localPlayerId,
  connectedPlayers,
  onSendMessage,
  onSendQuick,
  hotkeysEnabled,
  children,
}) => {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const isMine = (m: ChatMessage) => (localPlayerId && m.senderId ? m.senderId === localPlayerId : m.sender === playerName);

  const openChat = () => {
    setQuickOpen(false);
    setOpen(true);
    // Focus after the input mounts.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeChat = (clearDraft: boolean) => {
    inputRef.current?.blur();
    setOpen(false);
    if (clearDraft) setDraft("");
    setLastSeenAt(Date.now());
  };

  // Through a ref: the hotkey listener below is registered once.
  const onSendQuickRef = useRef(onSendQuick);
  onSendQuickRef.current = onSendQuick;
  const sendQuick = (id: QuickChatId) => {
    onSendQuickRef.current(id);
    setQuickOpen(false);
  };

  // Global hotkeys. Capture phase, so while the quick menu is open its number
  // keys are consumed here before App's hotbar handler sees them.
  const hotkeysRef = useRef(hotkeysEnabled);
  hotkeysRef.current = hotkeysEnabled;
  const quickOpenRef = useRef(quickOpen);
  quickOpenRef.current = quickOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingInField() || e.defaultPrevented) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (quickOpenRef.current) {
        const n = digitOf(e.code);
        if (n !== null && n >= 1 && n <= QUICK_CHAT_IDS.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!e.repeat) sendQuick(QUICK_CHAT_IDS[n - 1]);
          return;
        }
        if (e.key === "Escape") setQuickOpen(false);
      }

      if (!hotkeysRef.current || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        openChat();
      } else if (key === "z") {
        e.preventDefault();
        setQuickOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The quick menu closes itself after a few seconds.
  useEffect(() => {
    if (!quickOpen) return;
    const timer = setTimeout(() => setQuickOpen(false), QUICK_MENU_MS);
    return () => clearTimeout(timer);
  }, [quickOpen]);

  // Losing the pointer lock (Esc) while typing: drop the chat so the pause
  // menu shows cleanly and no half-typed input is left holding the keyboard.
  useEffect(() => {
    if (!open) return;
    const onLockChange = () => {
      if (!document.pointerLockElement && document.activeElement === inputRef.current) closeChat(true);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [open]);

  // While open, everything counts as read and the list follows new messages.
  useEffect(() => {
    if (!open) return;
    setLastSeenAt(Date.now());
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages]);

  // Closed: tick the fading feed only while something is on it.
  const newest = messages.length > 0 ? messages[messages.length - 1].receivedAt : 0;
  useEffect(() => {
    if (open || Date.now() - newest > FEED_MS) return;
    setNow(Date.now());
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - newest > FEED_MS) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [open, newest]);

  const unread = open ? 0 : messages.filter((m) => m.receivedAt > lastSeenAt && !isMine(m)).length;
  const feed = open ? [] : messages.filter((m) => now - m.receivedAt < FEED_MS).slice(-FEED_LINES);

  const suitOf = (m: ChatMessage): string | undefined =>
    m.senderId ? connectedPlayers.find((p) => p.id === m.senderId)?.suitColor : undefined;

  const renderLine = (m: ChatMessage, compact: boolean) => {
    const mine = isMine(m);
    const system = m.kind === "system";
    const quick = m.kind === "quick";
    const text = quick && m.quickId ? t(`quick.${m.quickId}` as MessageKey) : m.text;
    const color = mine ? "#deb81d" : suitOf(m) ?? "#d1bd66";
    return (
      <div className="break-words leading-snug">
        {!compact && <span className="text-[#a28e3b]/70 font-bold">[{m.time}] </span>}
        {system ? (
          <span className="text-emerald-400/90 font-bold">{t("chat.system")}: </span>
        ) : (
          <span className="font-bold" style={{ color }}>
            {m.sender}:{" "}
          </span>
        )}
        {quick && <Zap className="inline w-3 h-3 -mt-0.5 mr-0.5 text-sky-300" />}
        <span className={system ? "text-emerald-100/80 italic font-sans" : quick ? "text-sky-100 font-bold uppercase tracking-wide" : "text-gray-200 font-sans tracking-wide"}>
          {text}
        </span>
        {quick && m.distance !== undefined && (
          <span className="ml-1 text-[10px] text-sky-300/70 tabular-nums">· {t("chat.distance", { m: Math.round(m.distance) })}</span>
        )}
      </div>
    );
  };

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Handled here in full: stop it before App's global handler, which
      // would otherwise see the (now unfocused) Enter as "host starts game".
      e.preventDefault();
      e.stopPropagation();
      const text = draft.trim();
      if (text) onSendMessage(text);
      closeChat(true);
    } else if (e.key === "Escape") {
      closeChat(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    // Mouse users clicking the send button: send and keep the box open.
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div className="absolute left-4 bottom-22 w-[360px] flex flex-col justify-end gap-2 pointer-events-none">
      {/* Quick messages (Z) */}
      {quickOpen && (
        <div className="pointer-events-auto bg-[#0b0a05]/92 border border-sky-400/50 rounded p-2 shadow-[0_0_14px_rgba(56,189,248,0.25)]">
          <div className="flex items-center justify-between mb-1.5 text-[9px] font-black uppercase tracking-widest">
            <span className="text-sky-300 flex items-center gap-1">
              <Zap className="w-3 h-3" /> {t("quick.title")}
            </span>
            <span className="text-sky-300/60">{t("quick.hint")}</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_CHAT_IDS.map((id, i) => (
              <button
                key={id}
                onClick={() => sendQuick(id)}
                className="flex items-center gap-1.5 text-left rounded border border-sky-400/20 hover:border-sky-300 bg-sky-950/40 hover:bg-sky-900/50 px-1.5 py-1 text-[10px] font-bold uppercase text-sky-100 cursor-pointer transition-colors"
              >
                <span className="text-[9px] font-black text-sky-300 bg-black/50 rounded px-1">{i + 1}</span>
                <span className="truncate">{t(`quick.${id}` as MessageKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Open chat: full history + input */}
      {open ? (
        <div className="pointer-events-auto bg-[#0b0a05]/92 border border-[#a28e3b]/30 rounded p-3 flex flex-col h-56 shadow-lg">
          <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 text-xs select-text">
            {messages.length === 0 ? (
              <div className="text-[#a28e3b]/40 text-center py-6 text-[10px] italic">{t("hud.noMessages")}</div>
            ) : (
              messages.map((m) => <React.Fragment key={m.id}>{renderLine(m, false)}</React.Fragment>)
            )}
            <div ref={listEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="mt-2 flex gap-1 border-t border-[#a28e3b]/10 pt-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                maxLength={MAX_INPUT}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleInputKey}
                placeholder={t("hud.chatPlaceholder")}
                className="w-full bg-[#12110a] border border-[#a28e3b]/30 text-xs px-2.5 py-1.5 rounded outline-none text-[#deb81d] focus:border-[#deb81d]"
              />
              {draft.length > MAX_INPUT - 40 && (
                <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] tabular-nums ${draft.length >= MAX_INPUT ? "text-red-400" : "text-[#a28e3b]/60"}`}>
                  {draft.length}/{MAX_INPUT}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              title={t("quick.title")}
              className="border border-sky-400/30 hover:border-sky-300 text-sky-300 px-2 rounded cursor-pointer transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
            <button
              type="submit"
              id="btn-hud-chat-send"
              className="bg-[#deb81d] hover:bg-[#ebd255] text-black px-2.5 py-1 rounded cursor-pointer transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
          <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-[#a28e3b]/50">{t("chat.hint")}</div>
        </div>
      ) : (
        feed.length > 0 && (
          <div className="flex flex-col gap-1 text-xs">
            {feed.map((m) => (
              <div
                key={m.id}
                className="self-start max-w-full bg-black/60 border-l-2 border-[#deb81d]/50 rounded-r px-2 py-1 transition-opacity duration-1000"
                style={{ opacity: now - m.receivedAt > FEED_FADE_MS ? 0 : 1 }}
              >
                {renderLine(m, true)}
              </div>
            ))}
          </div>
        )
      )}

      {/* Buttons */}
      <div className="pointer-events-auto flex gap-2">
        <button
          onClick={() => (open ? closeChat(false) : openChat())}
          id="btn-hud-chat-toggle"
          className="flex items-center gap-2 bg-[#0b0a05]/85 hover:bg-[#141208] text-[#a28e3b] hover:text-[#deb81d] border border-[#a28e3b]/20 hover:border-[#deb81d]/40 rounded px-2.5 py-1.5 text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
        >
          <MessageSquare className="w-4 h-4" />
          {t("hud.chat")}
          {unread > 0 && (
            <span className="px-1.5 bg-[#deb81d] text-black font-extrabold rounded-full text-[9px] animate-pulse" title={t("chat.unread", { n: unread })}>
              {unread}
            </span>
          )}
        </button>
        {children}
      </div>
    </div>
  );
};

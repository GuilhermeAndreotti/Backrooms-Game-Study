/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { Monitor, X } from "lucide-react";

interface TerminalModalProps {
  /** Digits revealed by the documents found so far (null = not found yet). */
  digits: (number | null)[];
  /** Returns whether the code was accepted. */
  onSubmit: (code: string) => boolean;
  onClose: () => void;
}

/**
 * Level G's old computer in the main room: type the three-digit code from the
 * documents to release the emergency door. The game keeps running behind it —
 * the Finger King doesn't wait while you type.
 */
export const TerminalModal: React.FC<TerminalModalProps> = ({ digits, onSubmit, onClose }) => {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "denied">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 3) return;
    if (onSubmit(code)) {
      onClose();
    } else {
      setStatus("denied");
      setCode("");
      inputRef.current?.focus();
    }
  };

  const found = digits.filter((d) => d !== null).length;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 font-mono px-4">
      <form
        onSubmit={submit}
        className={`w-full max-w-md bg-[#030a05] border-2 border-[#1f7a3a] rounded p-6 shadow-[0_0_40px_rgba(60,255,122,0.18)] relative ${status === "denied" ? "animate-pulse" : ""}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar terminal"
          className="absolute top-3 right-3 text-[#3cff7a]/60 hover:text-[#3cff7a] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-[#3cff7a] border-b border-[#1f7a3a]/60 pb-2">
          <Monitor className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">SISADM v2.1 — Terminal 04</span>
        </div>

        <p className="mt-4 text-[11px] text-[#3cff7a]/80 uppercase leading-relaxed">
          Liberação da porta de emergência bloqueada. Insira o código de autorização de 3 dígitos.
        </p>

        <div className="mt-4 text-[11px] text-[#3cff7a]/60 uppercase tracking-wider">
          Registros encontrados ({found}/3):{" "}
          <span className="text-[#3cff7a] tracking-[0.4em] font-bold">
            {digits.map((d) => (d === null ? "_" : d)).join("")}
          </span>
        </div>

        <input
          ref={inputRef}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 3));
            setStatus("idle");
          }}
          inputMode="numeric"
          autoComplete="off"
          aria-label="Código de 3 dígitos"
          className="mt-4 w-full bg-black border border-[#1f7a3a] text-[#3cff7a] text-3xl text-center tracking-[0.6em] py-3 rounded outline-none focus:border-[#3cff7a]"
          placeholder="___"
        />

        <div className="h-5 mt-2 text-[11px] uppercase tracking-wider text-center">
          {status === "denied" && <span className="text-red-500 font-bold">Acesso negado</span>}
        </div>

        <button
          type="submit"
          disabled={code.length !== 3}
          className="mt-2 w-full bg-[#1f7a3a] hover:bg-[#2a9b4b] disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold uppercase tracking-widest py-2.5 rounded text-xs cursor-pointer"
        >
          Autorizar
        </button>
        <div className="mt-3 text-[9px] text-[#3cff7a]/40 uppercase text-center">[ESC] para sair do terminal</div>
      </form>
    </div>
  );
};

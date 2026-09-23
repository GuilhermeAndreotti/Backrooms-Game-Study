import { useState } from "react";

interface MegDoorModalProps {
  onSubmit: (ids: string) => boolean;
  onClose: () => void;
}

export function MegDoorModal({ onSubmit, onClose }: MegDoorModalProps) {
  const [ids, setIds] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    const ok = onSubmit(ids);
    if (ok) onClose();
    else setError(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg border border-sky-500/70 bg-[#101a22] p-6 text-slate-100 shadow-2xl">
        <div className="mb-1 text-xs tracking-[0.3em] text-sky-300">MEG // ACCESS CONTROL</div>
        <h2 className="mb-3 text-2xl font-bold text-white">Porta de acesso</h2>
        <p className="mb-5 text-sm text-slate-300">Digite os três IDs na ordem: Senior, Pleno, Junior.</p>
        <input
          autoFocus
          value={ids}
          onChange={(event) => { setIds(event.target.value.replace(/[^0-9,\s]/g, "").slice(0, 18)); setError(false); }}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
          inputMode="numeric"
          placeholder="4821, 7314, 1952"
          className="mb-2 w-full border border-slate-600 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-sky-400"
        />
        {error && <div className="mb-3 text-sm text-red-300">Acesso recusado. Consulte os três programadores novamente.</div>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
          <button onClick={submit} className="bg-sky-700 px-5 py-2 text-sm font-bold hover:bg-sky-600">AUTORIZAR</button>
        </div>
      </div>
    </div>
  );
}

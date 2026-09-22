interface LevelSelectorModalProps {
  isHost: boolean;
  onStart: (level: number) => void;
  onClose: () => void;
}

const LEVELS = [
  [0, "Level 0"], [1, "Level 1"], [2, "Level 2"], [3, "Level 3"],
  [4, "Level 4"], [6, "Level 6 · secreto"], [7, "Level 5"], [8, "Level G · secreto"],
] as const;

export function LevelSelectorModal({ isHost, onStart, onClose }: LevelSelectorModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 font-mono">
      <div className="w-full max-w-md border-2 border-cyan-700 bg-[#07131b] p-6 text-slate-100 shadow-[0_0_45px_rgba(14,165,233,0.2)]">
        <div className="text-xs tracking-[0.3em] text-cyan-300">ROOM // LEVEL SELECTOR</div>
        <h2 className="mt-2 text-2xl font-bold">Escolha o nível inicial</h2>
        <p className="mt-2 text-xs text-slate-400">A escolha do host será aplicada a toda a sala.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {LEVELS.map(([level, label]) => (
            <button key={level} disabled={!isHost} onClick={() => onStart(level)} className="border border-cyan-800 bg-cyan-950/50 px-3 py-3 text-left text-sm hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
              {label}
            </button>
          ))}
        </div>
        {!isHost && <p className="mt-4 text-xs text-amber-300">Somente o host pode iniciar a expedição.</p>}
        <button onClick={onClose} className="mt-5 w-full border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-white">FECHAR</button>
      </div>
    </div>
  );
}

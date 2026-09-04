/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { X, Trophy, Compass, Sparkles, Activity, Key, Skull, FileText, Lock, Unlock, Volume2, AlertTriangle, Award } from "lucide-react";
import { motion } from "motion/react";
import { Achievement } from "../types/achievements";
import { loadAchievements } from "../utils/achievements";

interface AchievementsHUDProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AchievementsHUD: React.FC<AchievementsHUDProps> = ({ isOpen, onClose }) => {
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  useEffect(() => {
    if (isOpen) {
      setAchievements(loadAchievements());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const progressPercent = achievements.length > 0 ? Math.round((unlockedCount / achievements.length) * 100) : 0;

  // Icon mapping
  const getIcon = (name: string, unlocked: boolean) => {
    const className = `w-6 h-6 ${unlocked ? "text-[#deb81d] animate-pulse" : "text-zinc-600"}`;
    switch (name) {
      case "Trophy": return <Trophy className={className} />;
      case "Compass": return <Compass className={className} />;
      case "Sparkles": return <Sparkles className={className} />;
      case "Activity": return <Activity className={className} />;
      case "Key": return <Key className={className} />;
      case "Skull": return <Skull className={className} />;
      case "FileText": return <FileText className={className} />;
      case "Unlock": return <Unlock className={className} />;
      case "Volume2": return <Volume2 className={className} />;
      case "AlertTriangle": return <AlertTriangle className={className} />;
      default: return <Award className={className} />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 font-mono select-none pointer-events-auto backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-2xl bg-[#0d0d07] border-2 border-[#deb81d] rounded shadow-[0_0_35px_rgba(222,184,29,0.25)] flex flex-col overflow-hidden h-[85vh] max-h-[620px]"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#deb81d]/20 flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-[#deb81d] animate-bounce" />
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-[#deb81d]">
                Menu de Conquistas
              </h2>
              <p className="text-[9px] text-[#a28e3b]/60 uppercase tracking-wide">
                Seu progresso de sobrevivência nas fendas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-ach-close"
            className="bg-black/50 border border-[#a28e3b]/30 text-[#a28e3b] hover:text-[#deb81d] hover:border-[#deb81d] p-1.5 rounded cursor-pointer transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress Bar Area */}
        <div className="px-5 py-4 bg-[#14140a]/40 border-b border-[#deb81d]/10 flex flex-col gap-2">
          <div className="flex justify-between items-center text-[11px] font-bold">
            <span className="text-[#a28e3b] uppercase">CONQUISTAS DESBLOQUEADAS:</span>
            <span className="text-[#deb81d]">{unlockedCount} / {achievements.length} ({progressPercent}%)</span>
          </div>
          <div className="w-full h-3 bg-black border border-[#a28e3b]/20 rounded-full p-0.5 overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              className="h-full bg-gradient-to-r from-[#8a7219] to-[#deb81d] rounded-full shadow-[0_0_8px_rgba(222,184,29,0.4)]"
            />
          </div>
        </div>

        {/* Scrollable list of achievements */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin scrollbar-thumb-[#a28e3b]/20">
          {achievements.map((ach) => (
            <div 
              key={ach.id}
              className={`flex items-start gap-4 p-4 rounded border transition-all ${
                ach.unlocked 
                  ? "bg-[#14140a] border-[#deb81d]/50 text-[#deb81d] shadow-[0_0_10px_rgba(222,184,29,0.05)]" 
                  : "bg-black/60 border-[#a28e3b]/10 text-[#a28e3b]/40 opacity-70"
              }`}
            >
              {/* Icon Container */}
              <div className={`p-2.5 rounded border shrink-0 ${
                ach.unlocked 
                  ? "bg-[#deb81d]/15 border-[#deb81d] shadow-[0_0_12px_rgba(222,184,29,0.15)]" 
                  : "bg-neutral-900/50 border-neutral-800"
              }`}>
                {ach.unlocked ? getIcon(ach.iconName, true) : <Lock className="w-6 h-6 text-zinc-700" />}
              </div>

              {/* Text metadata */}
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className={`text-xs font-black uppercase tracking-wider ${ach.unlocked ? "text-[#ebd255]" : "text-[#a28e3b]/50"}`}>
                    {ach.title}
                  </h3>
                  {ach.unlocked && ach.unlockedAt && (
                    <span className="text-[8px] text-zinc-500 uppercase font-semibold">
                      Desbloqueado: {ach.unlockedAt}
                    </span>
                  )}
                </div>
                <p className="font-sans text-[11px] text-stone-300 leading-normal">
                  {ach.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer info instructions */}
        <div className="p-4 border-t border-[#deb81d]/15 bg-black/40 text-center text-[10px] text-[#a28e3b]/50">
          <span>TECLA [K] OU CLIQUE NO X PARA FECHAR</span>
        </div>
      </motion.div>
    </div>
  );
};

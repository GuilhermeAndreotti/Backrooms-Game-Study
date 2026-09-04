/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { X, Backpack, Search, Calendar, Landmark, Info, Key, Image, Volume2, Sparkles, AlertTriangle, FileText, GlassWater } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface InventoryHUDProps {
  inventory: string[];
  isOpen: boolean;
  onClose: () => void;
  onUseItem?: (itemId: string) => void;
}

interface ItemDetails {
  id: string;
  name: string;
  type: string;
  icon: React.ReactNode;
  description: string;
  lore: string;
  clueTitle: string;
  clueText: string;
}

export const InventoryHUD: React.FC<InventoryHUDProps> = ({
  inventory,
  isOpen,
  onClose,
  onUseItem
}) => {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // If the inventory is closed, reset selected item
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedItem(null);
    }
  }, [isOpen]);

  const itemsMap: Record<string, ItemDetails> = {
    old_photo: {
      id: "old_photo",
      name: "Foto Antiga Desbotada",
      type: "MEMENTO / REGISTRO",
      icon: <Image className="w-5 h-5 text-amber-300" />,
      description: "Uma fotografia Polaroid analógica dos anos 90, com as bordas amareladas pela humidade severa e manchas de infiltração do carpete.",
      lore: "A imagem retrata uma família de três pessoas sorrindo de forma amigável em frente a uma residência suburbana típica da época. No entanto, todos os três rostos foram violentamente riscados e desfigurados com rabiscos pretos de caneta esferográfica, impossibilitando qualquer identificação.",
      clueTitle: "INSCRIÇÃO NO VERSO (EM TINTA VERMELHA SECA):",
      clueText: "\"ELES OUVEM O SILÊNCIO. QUANDO AS LUZES COMEÇAREM A PISCAR, NÃO FIQUE PARADO. CONTINUE MOVENDO-SE.\""
    },
    rusty_key: {
      id: "rusty_key",
      name: "Chave de Ferro Enferrujada",
      type: "ARTEFATO / CHAVE",
      icon: <Key className="w-5 h-5 text-amber-500" />,
      description: "Uma chave pesada de ferro fundido antigo, completamente corroída por uma espessa camada de ferrugem vermelha áspera ao toque.",
      lore: "Ao segurar a chave por tempo suficiente, você percebe que o metal está anormalmente frio, quase congelante. Mais estranho ainda é uma vibração de alta frequência pulsando no cabo da chave — um zumbido mecânico perpétuo que se alinha perfeitamente com a frequência das lâmpadas fluorescentes.",
      clueTitle: "NOTA EXTRAPOLADA DO EXPLORADOR:",
      clueText: "\"O mecanismo interno de certas portas escondidas parece se alimentar de distorções magnéticas. Guarde esta chave. Ela vibra mais forte quando próxima a fendas ou anomalias espaciais de transição de nível. Ela abre o portão do Nível 1!\""
    },
    cassette_tape: {
      id: "cassette_tape",
      name: "Fita Cassete Danificada",
      type: "MEMENTO / GRAVAÇÃO",
      icon: <Volume2 className="w-5 h-5 text-amber-400" />,
      description: "Uma fita cassete antiga de fita magnética marrom exposta. A carcaça de plástico preta está riscada e rachada nas bordas.",
      lore: "Ao aproximá-la do ouvido, você ouve ruídos de estática magnética pesada misturados com vozes distorcidas murmurando coordenadas incoerentes. Em uma etiqueta descascada lê-se: 'PROTOCOLO DE INFILTRAÇÃO 109'.",
      clueTitle: "GRAVAÇÃO DE ÁUDIO DECODIFICADA:",
      clueText: "\"Não confie nas sombras que se movem. A fenda é real, mas o portão para o nível 2 requer a chave de ferro. Ela ressoa com as lâmpadas do saguão...\""
    },
    strange_crystal: {
      id: "strange_crystal",
      name: "Cristal Luminescente",
      type: "ARTEFATO / ANOMALIA",
      icon: <Sparkles className="w-5 h-5 text-cyan-400" />,
      description: "Um fragmento cristalino geométrico que emite uma pulsação constante de luz ciano/turquesa brilhante.",
      lore: "O cristal não projeta sombra e parece flutuar milímetros acima de superfícies sólidas. Sua temperatura interna está sempre exatamente a zero graus, agindo como um dissipador térmico perfeito.",
      clueTitle: "PROPRIEDADES DA MATÉRIA ANÔMALA:",
      clueText: "\"Energia pura cristalizada a partir das dobras dimensionais. Sua mera presença repele distorções e clareia a visão de quem o segura.\""
    },
    liquid_pain: {
      id: "liquid_pain",
      name: "Frasco de Dor Líquida",
      type: "SUBSTÂNCIA PERIGOSA",
      icon: <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />,
      description: "Um pequeno frasco químico contendo um líquido viscoso vermelho-sangue que ferve e borbulha constantemente sem calor.",
      lore: "É uma substância de extrema toxicidade encontrada apenas em fendas profundas. O contato direto com a pele causa queimação severa e alucinações auditivas agudas.",
      clueTitle: "ALERTA SANITÁRIO DA M.E.G.:",
      clueText: "\"NÃO CONSUMA. NÃO ABRA O FRASCO. O contato corrói a integridade neural do explorador, reduzindo drasticamente sua resistência física.\""
    },
    diary_page: {
      id: "diary_page",
      name: "Página de Diário Rasgada",
      type: "MEMENTO / DIÁRIO",
      icon: <FileText className="w-5 h-5 text-yellow-300" />,
      description: "Um pedaço amarelado e rasgado de papel pautado arrancado de um diário de campo, manchado de óleo industrial preto.",
      lore: "O autor parece descrever os primeiros dias após o 'no-clip' acidental. A caligrafia começa firme, mas se deteriora em garranchos desesperados ao longo das linhas finais.",
      clueTitle: "NOTAS DE UM EXPLORADOR PERDIDO:",
      clueText: "\"Dia 12. As tubulações do Nível 2 não param de ranger. Os Hounds estão caçando em bandos agora. Corra. Se você ouvir algo atrás de você, não olhe. Apenas corra até o fim do portão.\""
    },
    almond_water: {
      id: "almond_water",
      name: "Água de Amêndoas (Almond Water)",
      type: "CONSUMÍVEL / SURVIVAL",
      icon: <GlassWater className="w-5 h-5 text-amber-300" />,
      description: "Uma garrafa de água de sabor doce e aroma suave de amêndoas, encontrada fluindo de tubulações e fendas.",
      lore: "A Água de Amêndoas é um recurso de sobrevivência indispensável nas Backrooms. Ela tem a incrível propriedade de acalmar os nervos, clarear a mente e reverter os efeitos paranoicos causados pela escuridão profunda e pela presença de entidades como os Smilers.",
      clueTitle: "EFEITO TERAPÊUTICO:",
      clueText: "\"Consumir este frasco restaura instantaneamente 20% da sua Sanidade mental e alivia parte da fadiga física acumulada.\""
    }
  };

  if (!isOpen) return null;

  const currentDetails = selectedItem ? itemsMap[selectedItem] : null;

  // Count items by ID to handle duplicates elegantly
  const itemCounts: Record<string, number> = inventory.reduce((acc: Record<string, number>, itemId) => {
    acc[itemId] = (acc[itemId] || 0) + 1;
    return acc;
  }, {});

  // Unique list of items present
  const uniqueItems = Object.keys(itemCounts);

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 font-mono select-none pointer-events-auto backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-4xl bg-[#0d0d07] border-2 border-[#deb81d] rounded shadow-[0_0_35px_rgba(222,184,29,0.25)] flex flex-col md:flex-row overflow-hidden h-[85vh] max-h-[620px]"
      >
        {/* LEFT SIDE: INVENTORY ITEMS LIST */}
        <div className="flex-1 p-5 flex flex-col border-r border-[#deb81d]/20 h-full overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#deb81d]/20 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Backpack className="w-5 h-5 text-[#deb81d] animate-pulse" />
              <h2 className="text-sm font-black uppercase tracking-widest text-[#deb81d]">
                Inventário do Explorador
              </h2>
            </div>
            <span className="text-[10px] text-[#a28e3b]/60 uppercase bg-[#deb81d]/5 px-2 py-0.5 rounded border border-[#deb81d]/10">
              {inventory.length} Item(s)
            </span>
          </div>

          {inventory.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="w-16 h-16 rounded-full border border-dashed border-[#a28e3b]/30 flex items-center justify-center opacity-50">
                <Backpack className="w-8 h-8 text-[#a28e3b]" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[#deb81d] font-bold uppercase tracking-wider">
                  Inventário Vazio
                </p>
                <p className="text-[10px] text-[#a28e3b]/60 uppercase max-w-xs leading-relaxed">
                  Não há registros ou artefatos no seu inventário. Explore as salas procedurais para coletar pistas e mementos.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-2 gap-3 auto-rows-max">
              {uniqueItems.map((itemId) => {
                const details = itemsMap[itemId];
                if (!details) return null;
                const count = itemCounts[itemId];
                const isSelected = selectedItem === itemId;

                return (
                  <button
                    key={itemId}
                    id={`btn-inv-item-${itemId}`}
                    onClick={() => setSelectedItem(itemId)}
                    className={`flex flex-col items-start p-3 rounded text-left border cursor-pointer transition-all ${
                      isSelected 
                        ? "bg-[#deb81d]/15 border-[#deb81d] shadow-[0_0_12px_rgba(222,184,29,0.15)] text-[#deb81d]" 
                        : "bg-[#14140a] hover:bg-[#1a1a0d] border-[#a28e3b]/20 hover:border-[#deb81d]/50 text-[#a28e3b]"
                    }`}
                  >
                    <div className="flex justify-between items-center w-full mb-2">
                      <div className="p-1.5 bg-black/40 rounded border border-[#deb81d]/10">
                        {details.icon}
                      </div>
                      {count > 1 && (
                        <span className="bg-[#deb81d] text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">
                          x{count}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-wider block truncate w-full mb-1">
                      {details.name}
                    </span>
                    <span className="text-[8px] text-[#a28e3b]/50 uppercase tracking-widest font-semibold block">
                      {details.type}
                    </span>
                    
                    <div className="flex items-center gap-1 mt-3 text-[9px] text-[#deb81d] opacity-80 group">
                      <Search className="w-3 h-3 group-hover:scale-125 transition-transform" />
                      <span>INSPECIONAR ITEM</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Controls instructions */}
          <div className="mt-4 pt-3 border-t border-[#deb81d]/15 flex items-center justify-between text-[10px] text-[#a28e3b]/50">
            <span>TECLA [I] OU CLIQUE NO X PARA FECHAR</span>
            <span>EQUIPAMENTO DE PESQUISA</span>
          </div>
        </div>

        {/* RIGHT SIDE: INSPECTION LIGHTBOX WINDOW */}
        <div className="flex-1 bg-black/95 p-5 flex flex-col h-full overflow-y-auto relative">
          {/* Close main inventory panel button */}
          <button
            onClick={onClose}
            id="btn-inv-close"
            className="absolute top-4 right-4 bg-black/50 border border-[#a28e3b]/30 text-[#a28e3b] hover:text-[#deb81d] hover:border-[#deb81d] p-1.5 rounded cursor-pointer transition-all z-10"
          >
            <X className="w-4 h-4" />
          </button>

          {!selectedItem ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#a28e3b]/40">
              <Search className="w-10 h-10 mb-2 stroke-1 text-[#a28e3b]/30" />
              <p className="text-[11px] uppercase tracking-wider font-bold">
                Nenhum Item Selecionado
              </p>
              <p className="text-[9px] uppercase max-w-xs mt-1">
                Selecione um artefato à esquerda para ler anotações, decifrar inscrições e inspecionar detalhes em alta resolução.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full justify-between py-2">
              <div className="space-y-4">
                {/* Item header */}
                <div className="border-b border-[#deb81d]/20 pb-3">
                  <span className="text-[9px] text-[#deb81d] bg-[#deb81d]/10 px-2 py-0.5 rounded border border-[#deb81d]/20 tracking-widest uppercase font-extrabold inline-block mb-1.5">
                    {currentDetails?.type}
                  </span>
                  <h3 className="text-sm font-black uppercase tracking-wider text-[#deb81d]">
                    {currentDetails?.name}
                  </h3>
                </div>

                {/* 3D-Like Pure CSS Visual Asset Viewport */}
                <div className="w-full h-44 rounded bg-[#0b0a05] border border-[#a28e3b]/30 flex items-center justify-center overflow-hidden relative shadow-inner">
                  {/* Subtle Grid Scanning Effect */}
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(222,184,29,0.06),transparent_80%)]" />
                  <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-[#deb81d]/20 to-transparent animate-pulse" />

                  {/* Render Visual Representation based on Item */}
                  {selectedItem === "old_photo" && (
                    <motion.div 
                      initial={{ rotate: -4, scale: 0.9 }}
                      animate={{ rotate: 1, scale: 1 }}
                      className="w-28 h-32 bg-[#fafaf5] p-2 pb-5 rounded-sm shadow-[0_12px_25px_rgba(0,0,0,0.8)] border border-stone-200 flex flex-col gap-1 z-10"
                    >
                      {/* Faded picture content */}
                      <div className="flex-1 bg-gradient-to-b from-stone-900 via-neutral-950 to-stone-900 rounded-sm relative flex items-center justify-center overflow-hidden">
                        {/* Polaroid silhouette content */}
                        <div className="w-14 h-16 bg-gradient-to-t from-stone-950 via-amber-950/20 to-stone-900 rounded-full blur-[4px] absolute" />
                        <div className="w-3 h-10 bg-amber-300/10 rounded-full filter blur-[6px] absolute -top-2 left-6" />
                        <span className="text-[6px] text-red-600/40 font-mono tracking-tighter absolute bottom-1 uppercase select-none font-bold">1998 MEMENTO</span>
                        
                        {/* Red scribble marks on faces */}
                        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-80" viewBox="0 0 100 100">
                          <path d="M 30 35 L 70 35 M 32 32 L 68 38 M 31 38 L 69 32" stroke="red" strokeWidth="2.5" fill="none" />
                          <path d="M 25 45 L 75 55 M 28 55 L 72 45" stroke="black" strokeWidth="2" fill="none" />
                        </svg>
                      </div>
                      
                      {/* Pencil handwriting on polaroid base */}
                      <div className="h-4 flex items-center justify-center border-t border-stone-200/50 mt-1 select-none">
                        <span className="text-[8px] text-stone-600 font-sans italic tracking-tighter uppercase">No escape here</span>
                      </div>
                    </motion.div>
                  )}

                  {selectedItem === "rusty_key" && (
                    <motion.div 
                      initial={{ scale: 0.85, rotate: 15 }}
                      animate={{ scale: 1, rotate: -45 }}
                      className="relative w-16 h-28 flex flex-col items-center justify-center z-10"
                    >
                      {/* Glowing orange background aura */}
                      <div className="absolute w-24 h-24 rounded-full bg-amber-500/10 filter blur-xl" />

                      {/* Pure CSS Skeleton Key Drawing */}
                      <div className="flex flex-col items-center">
                        {/* Key head ring */}
                        <div className="w-9 h-9 rounded-full border-[6px] border-[#9c5c3c] shadow-[0_0_12px_rgba(156,92,60,0.5)] flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-[#14140a]" />
                        </div>
                        {/* Collar shaft separator */}
                        <div className="w-4 h-1.5 bg-[#8b4513] rounded-sm -mt-0.5" />
                        {/* Shaft */}
                        <div className="w-2.5 h-14 bg-[#9c5c3c]" />
                        {/* Base bite */}
                        <div className="w-6 h-5 flex flex-col justify-between items-end -mt-3 mr-4">
                          <div className="w-4.5 h-1.5 bg-[#8b4513] rounded-sm" />
                          <div className="w-3 h-1.5 bg-[#9c5c3c] rounded-sm" />
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {selectedItem === "cassette_tape" && (
                    <motion.div 
                      initial={{ scale: 0.85, rotate: -15 }}
                      animate={{ scale: 1, rotate: 5 }}
                      className="relative w-28 h-18 bg-[#1f1e1a] border border-[#a28e3b]/30 rounded-sm p-1.5 flex flex-col justify-between z-10 shadow-[0_8px_16px_rgba(0,0,0,0.8)]"
                    >
                      <div className="flex justify-between items-center text-[7px] text-[#a28e3b]/80 border-b border-[#a28e3b]/20 pb-0.5">
                        <span>SIDE A</span>
                        <span className="animate-pulse">▶ REC</span>
                      </div>
                      <div className="flex-1 flex items-center justify-center gap-3 py-1 bg-black/50 rounded-sm my-1">
                        <div className="w-5 h-5 rounded-full border border-dashed border-[#a28e3b]/50 flex items-center justify-center animate-spin" style={{ animationDuration: '6s' }}>
                          <div className="w-1 h-1 bg-[#a28e3b] rounded-full" />
                        </div>
                        <div className="w-6 h-1.5 bg-neutral-800 rounded-full" />
                        <div className="w-5 h-5 rounded-full border border-dashed border-[#a28e3b]/50 flex items-center justify-center animate-spin" style={{ animationDuration: '6s' }}>
                          <div className="w-1 h-1 bg-[#a28e3b] rounded-full" />
                        </div>
                      </div>
                      <div className="text-[6px] text-[#ebd255] text-center font-bold tracking-widest bg-[#deb81d]/10 py-0.5 rounded-sm">
                        INFILTRATION-109
                      </div>
                    </motion.div>
                  )}

                  {selectedItem === "strange_crystal" && (
                    <motion.div 
                      initial={{ scale: 0.8, y: 10 }}
                      animate={{ scale: 1, y: -10 }}
                      transition={{ repeat: Infinity, repeatType: "reverse", duration: 2, ease: "easeInOut" }}
                      className="relative w-12 h-20 flex items-center justify-center z-10"
                    >
                      <div className="absolute w-20 h-20 rounded-full bg-cyan-500/20 filter blur-xl animate-pulse" />
                      {/* Crystal 3D Polygon structure rendered in pure CSS clipping */}
                      <div className="w-10 h-16 bg-gradient-to-t from-cyan-600 via-cyan-400 to-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.6)]" style={{ clipPath: "polygon(50% 0%, 100% 30%, 100% 70%, 50% 100%, 0% 70%, 0% 30%)" }} />
                    </motion.div>
                  )}

                  {selectedItem === "liquid_pain" && (
                    <motion.div 
                      initial={{ scale: 0.85, rotate: 10 }}
                      animate={{ scale: 1, rotate: -10 }}
                      transition={{ repeat: Infinity, repeatType: "reverse", duration: 1.5, ease: "easeInOut" }}
                      className="relative w-12 h-24 flex flex-col items-center justify-center z-10"
                    >
                      <div className="absolute w-16 h-16 rounded-full bg-red-600/20 filter blur-xl animate-pulse" />
                      {/* Flask Cap */}
                      <div className="w-5 h-2 bg-[#222222] border border-[#a28e3b]/40 rounded-t" />
                      {/* Flask Neck */}
                      <div className="w-3 h-4 bg-gradient-to-r from-red-800 to-red-600 border-x border-[#a28e3b]/30" />
                      {/* Flask Body */}
                      <div className="w-10 h-14 bg-gradient-to-b from-red-600 via-red-950 to-red-900 border border-[#a28e3b]/40 rounded-b-md relative overflow-hidden flex items-end justify-center pb-2">
                        {/* Boiling bubbles inside liquid */}
                        <div className="absolute bottom-1 w-8 h-8 rounded-full bg-red-500/40 filter blur-xs animate-ping" />
                        <span className="text-[5px] text-white/50 font-bold uppercase select-none tracking-tighter">CAUTION</span>
                      </div>
                    </motion.div>
                  )}

                  {selectedItem === "diary_page" && (
                    <motion.div 
                      initial={{ rotate: -5, scale: 0.9 }}
                      animate={{ rotate: 2, scale: 1 }}
                      className="w-28 h-36 bg-[#ede6d0] border border-stone-400 p-3 flex flex-col justify-between relative shadow-[0_12px_24px_rgba(0,0,0,0.7)] z-10"
                      style={{ clipPath: "polygon(0% 0%, 95% 0%, 100% 5%, 100% 95%, 92% 100%, 5% 100%, 0% 92%)" }}
                    >
                      <div className="flex-1 border-l border-red-400/50 pl-2 select-text text-[7px] text-stone-700 leading-tight space-y-1">
                        <div className="text-[5px] text-stone-400 text-right uppercase tracking-wider font-bold">PAGE 47</div>
                        <p className="italic">"...não pare por nada..."</p>
                        <p className="italic">"...as paredes respiram..."</p>
                        <p className="italic">"...use a chave para o portão do nível 1..."</p>
                        <p className="italic">"...corra..."</p>
                      </div>
                      <div className="h-0.5 bg-gradient-to-r from-transparent via-stone-400/40 to-transparent" />
                      <div className="text-[6px] text-stone-400 uppercase text-center tracking-widest font-semibold italic">DIÁRIO PERDIDO</div>
                    </motion.div>
                  )}

                  {selectedItem === "almond_water" && (
                    <motion.div 
                      initial={{ scale: 0.85, rotate: -5 }}
                      animate={{ scale: 1, rotate: 5 }}
                      transition={{ repeat: Infinity, repeatType: "reverse", duration: 2, ease: "easeInOut" }}
                      className="relative w-12 h-24 flex flex-col items-center justify-center z-10"
                    >
                      <div className="absolute w-16 h-16 rounded-full bg-amber-200/20 filter blur-xl animate-pulse" />
                      {/* Bottle Cap */}
                      <div className="w-4 h-2 bg-stone-700 border border-[#a28e3b]/30 rounded-t" />
                      {/* Bottle Neck */}
                      <div className="w-2.5 h-4 bg-stone-400/30 border-x border-stone-500/25" />
                      {/* Bottle Body */}
                      <div className="w-9 h-14 bg-stone-300/20 border border-[#deb81d]/30 rounded-b-md relative overflow-hidden flex items-end justify-center pb-1">
                        {/* Creamy Almond Fluid inside */}
                        <div className="absolute bottom-0 inset-x-0 h-[80%] bg-gradient-to-t from-amber-900/60 via-amber-800/40 to-amber-700/20" />
                        {/* Glowing sparkles */}
                        <div className="absolute bottom-2 w-6 h-6 rounded-full bg-amber-400/25 filter blur-xs animate-ping" />
                        <span className="text-[6px] text-[#deb81d] font-bold uppercase select-none tracking-tighter z-10 bg-black/60 px-1 rounded border border-[#deb81d]/20">ALMOND</span>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Narrative explanation */}
                <div className="space-y-3">
                  <div className="flex gap-2 items-start text-[#a28e3b] text-xs leading-relaxed">
                    <Info className="w-4 h-4 text-[#deb81d] shrink-0 mt-0.5" />
                    <p className="font-sans text-stone-300">
                      {currentDetails?.description}
                    </p>
                  </div>
                  <p className="font-sans text-xs text-stone-400 leading-relaxed italic bg-black/40 p-3 rounded border border-stone-900">
                    {currentDetails?.lore}
                  </p>
                </div>

                {/* Handwritten or highlighted clue citation */}
                <div className="bg-[#121107] border border-[#deb81d]/30 rounded p-3.5 space-y-1.5 shadow-md">
                  <h4 className="text-[10px] font-black uppercase text-[#deb81d] tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                    {currentDetails?.clueTitle}
                  </h4>
                  <p className="text-[11px] font-semibold text-[#ebd255] italic tracking-wide leading-relaxed pl-3 font-mono border-l-2 border-red-500/50">
                    {currentDetails?.clueText}
                  </p>
                </div>
              </div>

              {/* Action back instructions */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                {selectedItem === "almond_water" && (
                  <button
                    id="btn-consume-almond-water"
                    onClick={() => {
                      if (onUseItem) {
                        onUseItem("almond_water");
                      }
                      const count = inventory.filter(id => id === "almond_water").length;
                      if (count <= 1) {
                        setSelectedItem(null);
                      }
                    }}
                    className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 border border-amber-300 text-black text-[11px] uppercase font-black px-5 py-2 rounded cursor-pointer transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse pointer-events-auto"
                  >
                    CONSUMIR ÁGUA DE AMÊNDOAS (+20% Sanidade)
                  </button>
                )}

                <button
                  onClick={() => setSelectedItem(null)}
                  className="bg-stone-900 border border-stone-700 hover:border-[#deb81d] text-[10px] uppercase font-bold text-stone-400 hover:text-[#deb81d] px-4 py-2 rounded cursor-pointer transition-all pointer-events-auto"
                >
                  Voltar à Lista de Itens
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { GameSettings, ConnectionPhase, RemotePlayer, ChatMessage } from "./types/game";
import { GameEngine } from "./game/GameEngine";
import { MainMenu } from "./components/MainMenu";
import { GameHUD } from "./components/GameHUD";
import { InventoryHUD } from "./components/InventoryHUD";
import { AchievementsHUD } from "./components/AchievementsHUD";
import { addAchievementListener, removeAchievementListener, unlockAchievement } from "./utils/achievements";
import { BackroomsLore, generateProceduralLore } from "./utils/lore";
import { Loader2, AlertCircle, RefreshCw, HelpCircle, Trophy, X, FileText, Compass, Skull } from "lucide-react";

const SETTINGS_STORAGE_KEY = "backrooms_lvl0_settings";

const defaultSettings: GameSettings = {
  name: `Infiltrado #${Math.floor(Math.random() * 900) + 100}`,
  mouseSensitivity: 5,
  fov: 75,
  volumeMaster: 0.5,
  volumeHum: 0.6,
  volumeSfx: 0.7,
  ipAddress: "sala-principal",
  port: "0",
  quality: "auto",
  adaptiveResolution: true,
  showFps: false,
};

/**
 * How often remote player positions are pushed into React state.
 *
 * The server streams ~25 updates per second per player. Writing each one into
 * state re-rendered the whole HUD tree dozens of times a second while the 3D
 * scene was already fighting for the main thread. The engine and the radar read
 * live positions from a ref instead; React only needs a slow refresh for the
 * roster text.
 */
const ROSTER_REFRESH_MS = 250;

/**
 * Lobby identifier. The game is now served from a single host, so the old
 * "IP + port" pair only ever acted as a room name — this normalises it into one.
 */
function roomKeyFor(settings: GameSettings): string {
  const raw = (settings.ipAddress || "").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "sala-principal";
}

export default function App() {
  const [settings, setSettings] = useState<GameSettings>(defaultSettings);
  const [phase, setPhase] = useState<ConnectionPhase>(ConnectionPhase.MENU);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentSeed, setCurrentSeed] = useState<number>(0);
  
  // Real-time telemetry feeding from Game loop
  const [stamina, setStamina] = useState(1.0);
  const [sanity, setSanity] = useState(1.0);
  const [isFlashlightOn, setIsFlashlightOn] = useState(false);
  const [playerState, setPlayerState] = useState("idle");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockedOverride, setPointerLockedOverride] = useState(false);
  const [redRoomExposure, setRedRoomExposure] = useState(0);
  const [currentSector, setCurrentSector] = useState("");
  const [inventory, setInventory] = useState<string[]>([]);
  const [activeLoreNote, setActiveLoreNote] = useState<BackroomsLore | null>(null);
  const [collectedNotes, setCollectedNotes] = useState<BackroomsLore[]>([]);
  const [pauseMenuTab, setPauseMenuTab] = useState<"controles" | "diario">("controles");
  const [selectedJournalNote, setSelectedJournalNote] = useState<BackroomsLore | null>(null);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
  const [achievementToast, setAchievementToast] = useState<{ id: string; title: string; description: string } | null>(null);

  useEffect(() => {
    const handleUnlock = (ach: any) => {
      setAchievementToast(ach);
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
      } catch (e) {
        // Silently catch audio context blockers
      }
    };
    addAchievementListener(handleUnlock);
    return () => removeAchievementListener(handleUnlock);
  }, []);

  useEffect(() => {
    if (achievementToast) {
      const timer = setTimeout(() => {
        setAchievementToast(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [achievementToast]);
  const [hudNotification, setHudNotification] = useState("");
  const [notificationKey, setNotificationKey] = useState(0);

  const triggerNotification = (msg: string) => {
    setHudNotification(msg);
    setNotificationKey((prev) => prev + 1);
  };

  // Networking states
  const [connectedPlayers, setConnectedPlayers] = useState<RemotePlayer[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // Map loading states ("Só deixe jogar quando o mapa carregar completamente")
  const [loadingMap, setLoadingMap] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Game levels
  const [currentLevel, setCurrentLevel] = useState(0);

  // Live FPS readout fed by the engine (never drives a re-render on its own).
  const [perf, setPerf] = useState({ fps: 0, scale: 1 });

  // Core references
  const socketRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  /**
   * Authoritative roster, mutated at network rate. `connectedPlayers` is a slow
   * mirror of this used only for rendering text; the radar reads the ref.
   */
  const playersRef = useRef<RemotePlayer[]>([]);
  const rosterDirtyRef = useRef(false);
  /** Own player id, read inside socket handlers without re-subscribing. */
  const clientIdRef = useRef<string | null>(null);

  /** Marks the roster changed; a timer flushes it into React state. */
  const touchRoster = useCallback(() => {
    rosterDirtyRef.current = true;
  }, []);

  useEffect(() => {
    if (phase !== ConnectionPhase.PLAYING && phase !== ConnectionPhase.LOBBY) return;
    const timer = setInterval(() => {
      if (!rosterDirtyRef.current) return;
      rosterDirtyRef.current = false;
      setConnectedPlayers(playersRef.current.map((p) => ({ ...p })));
    }, ROSTER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [phase]);

  // 1. Load settings on lifecycle start
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GameSettings>;
        // Older saves stored a literal IP address here; it is a room name now.
        if (parsed.ipAddress && /^[\d.]+$/.test(parsed.ipAddress)) {
          delete parsed.ipAddress;
          delete parsed.port;
        }
        setSettings({ ...defaultSettings, ...parsed });
      }
    } catch (e) {
      console.warn("Could not load persisted local settings:", e);
    }
  }, []);

  // Update persistent configurations
  const handleUpdateSettings = (newSettings: GameSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch (e) {
      console.error("Failed to persist local settings:", e);
    }

    // Dynamic config adjustments if engine is active
    if (engineRef.current) {
      engineRef.current.updateConfig(newSettings);
    }
  };

  // Applying a graphics preset mid-session reconfigures the renderer in place —
  // no reconnect, no map reload.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const resolved = settings.quality === "auto" ? engine.qualityLevel : settings.quality;
    if (resolved !== engine.qualityLevel) {
      engine.setQuality(resolved);
    }
  }, [settings.quality]);

  // Keyboard listener for toggling inventory & achievements
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase !== ConnectionPhase.PLAYING) return;
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setIsAchievementsOpen(false);
        setIsInventoryOpen((prev) => {
          const nextState = !prev;
          if (nextState) {
            document.exitPointerLock?.();
          }
          return nextState;
        });
      } else if (e.key === "k" || e.key === "K") {
        // Achievements moved off "C": that key is also crouch, so opening the
        // panel released the pointer lock every time the player crouched.
        e.preventDefault();
        setIsInventoryOpen(false);
        setIsAchievementsOpen((prev) => {
          const nextState = !prev;
          if (nextState) {
            document.exitPointerLock?.();
          }
          return nextState;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase]);

  // Measure pointer lock states continuously during active gameplay
  useEffect(() => {
    if (phase !== ConnectionPhase.PLAYING) return;

    const handleLock = () => {
      const canvasEl = document.querySelector("#threejs-viewport canvas");
      const locked = document.pointerLockElement === canvasEl;
      setPointerLocked(locked);
      if (locked) {
        setPointerLockedOverride(false);
      }
    };

    document.addEventListener("pointerlockchange", handleLock);
    return () => document.removeEventListener("pointerlockchange", handleLock);
  }, [phase]);

  // 2. Network connection setup
  const connectToLobby = (forceSeed?: number) => {
    setPhase(ConnectionPhase.CONNECTING);
    setErrorMessage("");
    setChatMessages([]);
    setConnectedPlayers([]);
    playersRef.current = [];

    try {
      // Build protocol routes (SSL supporting)
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      // Dedicated path so a reverse proxy can route the upgrade explicitly.
      const socketUrl = `${protocol}//${host}/ws`;

      console.log(`Connecting explorer to WebSockets relay at ${socketUrl}...`);
      const socket = new WebSocket(socketUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket open. Requesting lobby infiltration...");
        socket.send(JSON.stringify({
          type: "join",
          room: roomKeyFor(settings),
          name: settings.name,
          requestedSeed: forceSeed,
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type } = data;

          if (type === "room_full") {
            setErrorMessage(data.error || "A sala de infiltração selecionada atingiu o limite de 4 exploradores.");
            setPhase(ConnectionPhase.ERROR);
            socket.close();
          }

          else if (type === "joined") {
            const { id: myId, seed, players: currentOn } = data;
            console.log(`Infiltration confirmed! Seed acquired: ${seed}. Connecting visuals...`);
            setClientId(myId);
            clientIdRef.current = myId;
            playersRef.current = currentOn;
            setConnectedPlayers(currentOn);
            setCurrentSeed(seed);
            setPhase(ConnectionPhase.PLAYING);

            // Progressive map loader ("Só deixe jogar quando o mapa carregar completamente")
            setLoadingMap(true);
            setLoadingProgress(0);

            // Mount the central GameEngine
            // Use setTimeout to ensure the viewport element is fully painted in DOM
            setTimeout(() => {
              try {
                if (engineRef.current) {
                  engineRef.current.destroy();
                }

                engineRef.current = new GameEngine(
                  "threejs-viewport",
                  settings,
                  seed,
                  socket,
                  {
                    onStaminaChange: (st) => setStamina(st),
                    onStateChange: (st) => setPlayerState(st),
                    onFlashlightChange: (fl) => setIsFlashlightOn(fl),
                    onPerformanceSample: (fps, scale) => setPerf({ fps, scale }),
                    onEscapeTrigger: () => {
                      setRedRoomExposure(0);
                      const engine = engineRef.current;
                      if (!engine) return;

                      if (engine.level === 0 || engine.level === 1) {
                        const nextLevel = engine.level + 1;
                        console.log(`Explorer successfully noclipped into Level ${nextLevel}!`);
                        if (nextLevel === 1) unlockAchievement("noclip_master");

                        setLoadingMap(true);
                        setLoadingProgress(0);
                        setCurrentLevel(nextLevel);
                        engine.transitionToLevel(nextLevel, seed, settings);

                        if (engine.player) {
                          engine.player.mapFullyLoaded = false;
                        }

                        engine.precreateMap((p) => {
                          setLoadingProgress(Math.round(p * 100));
                        }).then(() => {
                          setLoadingProgress(100);
                          setTimeout(() => {
                            setLoadingMap(false);
                            if (engineRef.current?.player) {
                              engineRef.current.player.mapFullyLoaded = true; // Unlock controls!
                            }
                          }, 350);
                        }).catch((err) => {
                          console.error(`Error during Level ${nextLevel} precreation:`, err);
                          setLoadingMap(false);
                          if (engineRef.current?.player) {
                            engineRef.current.player.mapFullyLoaded = true;
                          }
                        });
                      } else {
                        console.log("Explorer successfully escaped the Backrooms!");
                        unlockAchievement("absolute_survivor");
                        setPhase(ConnectionPhase.ESCAPED);
                        if (engineRef.current) {
                          engineRef.current.destroy();
                          engineRef.current = null;
                        }
                        if (socketRef.current) {
                          socketRef.current.close();
                          socketRef.current = null;
                        }
                      }
                    },
                    onRedRoomExposureChange: (exp) => setRedRoomExposure(exp),
                    onHUDNotification: (msg) => triggerNotification(msg),
                    onSectorChange: (sec) => setCurrentSector(sec),
                    onInventoryChange: (items) => setInventory(items),
                    onSanityChange: (san) => {
                      setSanity(san);
                      if (san <= 0) {
                        setPhase(ConnectionPhase.GAME_OVER);
                        document.exitPointerLock?.();
                        if (engineRef.current) {
                          engineRef.current.destroy();
                          engineRef.current = null;
                        }
                        if (socketRef.current) {
                          socketRef.current.close();
                          socketRef.current = null;
                        }
                      }
                    },
                    onScrapOfNoteCollected: (noteSeed) => {
                      const lore = generateProceduralLore(noteSeed);
                      setCollectedNotes((prev) => {
                        if (prev.some((n) => n.title === lore.title)) return prev;
                        return [...prev, lore];
                      });
                      setActiveLoreNote(lore);
                      document.exitPointerLock?.();
                    },
                  }
                );

                // Set player lock state during generation to guarantee no movement
                if (engineRef.current && engineRef.current.player) {
                  engineRef.current.player.mapFullyLoaded = false;
                }

                // Instantly spawn existing players
                currentOn.forEach((p: RemotePlayer) => {
                  engineRef.current?.spawnRemotePlayer(p.id, p.name, p.x, p.y, p.z);
                });

                // Track real asynchronous map precreation cells loading progress for Level 0
                engineRef.current?.precreateMap((p) => {
                  setLoadingProgress(Math.round(p * 100));
                }).then(() => {
                  setLoadingProgress(100);
                  unlockAchievement("first_steps");
                  setTimeout(() => {
                    setLoadingMap(false);
                    if (engineRef.current && engineRef.current.player) {
                      engineRef.current.player.mapFullyLoaded = true; // Unlock controls!
                    }
                  }, 350);
                }).catch((err) => {
                  console.error("Error during Level 0 precreation:", err);
                  setLoadingMap(false);
                  if (engineRef.current && engineRef.current.player) {
                    engineRef.current.player.mapFullyLoaded = true;
                  }
                });
              } catch (err) {
                console.error("Critical crash during game initialization:", err);
                setErrorMessage("Falha de alocação no motor gráfico 3D.");
                setPhase(ConnectionPhase.ERROR);
              }
            }, 50);
          }

          else if (type === "player_joined") {
            const { player } = data;
            if (!playersRef.current.some((p) => p.id === player.id)) {
              playersRef.current = [...playersRef.current, player];
              touchRoster();
            }

            // Update 3D engine world
            if (engineRef.current) {
              engineRef.current.spawnRemotePlayer(player.id, player.name, player.x, player.y, player.z);
            }

            // Standard terminal join announcement message
            logSystemMessage(`[SINAL DE EXPEDIÇÃO DETECTADO]: ${player.name.toUpperCase()} REUNIU-SE AO GRUPO.`);
          }

          else if (type === "players_snapshot") {
            // One batched frame per server tick carrying every teammate that
            // moved. Mutating in place keeps this off React's render path.
            const incoming: RemotePlayer[] = data.players || [];
            let added = false;

            for (const player of incoming) {
              if (player.id === clientIdRef.current) continue; // ignore our own echo

              const existing = playersRef.current.find((p) => p.id === player.id);
              if (existing) {
                Object.assign(existing, player);
              } else {
                playersRef.current = [...playersRef.current, player];
                added = true;
              }

              engineRef.current?.updateRemotePlayer(player.id, player);
            }

            if (added || incoming.length > 0) touchRoster();
          }

          else if (type === "player_left") {
            const { id: leftId } = data;
            const departing = playersRef.current.find((p) => p.id === leftId);
            if (departing) {
              logSystemMessage(`[SINAL DE EXPEDIÇÃO PERDIDO]: ${departing.name.toUpperCase()} DESCONECTOU-SE DESTE SETOR.`);
            }
            playersRef.current = playersRef.current.filter((p) => p.id !== leftId);
            touchRoster();

            // Erase 3D nodes
            if (engineRef.current) {
              engineRef.current.removeRemotePlayer(leftId);
            }
          }

          else if (type === "chat_message") {
            const { sender, text } = data;
            const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            setChatMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substr(2, 9),
                sender,
                text,
                time: timeStr,
              }
            ]);
          }

        } catch (err) {
          console.error("Failed to parse incoming socket package:", err);
        }
      };

      socket.onclose = () => {
        console.log("Relay socket connection severed by remote.");
        // If we were active in game, transition back gracefully reporting connection issues
        if (phase === ConnectionPhase.PLAYING) {
          disconnect(true, "A ligação com a fenda do Level 0 foi interrompida.");
        }
      };

      socket.onerror = (e) => {
        console.error("Networking Socket Error reported:", e);
        setErrorMessage("Erro de requisição na fenda de rede. Verifique o servidor.");
        setPhase(ConnectionPhase.ERROR);
      };

    } catch (e) {
      console.error(e);
      setErrorMessage("Não foi possível estabelecer contato com o servidor.");
      setPhase(ConnectionPhase.ERROR);
    }
  };

  const handleSendMessage = (text: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "chat",
        message: text,
      }));
    }
  };

  const logSystemMessage = (text: string) => {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    setChatMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        sender: "DISTANTE-LINK",
        text,
        time: timeStr,
      }
    ]);
  };

  /**
   * Safe disconnect/wipe callback returning to main menu.
   */
  const disconnect = (hasError = false, errorMsg = "") => {
    // Purge engine
    if (engineRef.current) {
      engineRef.current.destroy();
      engineRef.current = null;
    }

    // Sever sockets
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setCurrentLevel(0);
    setClientId(null);
    clientIdRef.current = null;
    playersRef.current = [];
    setConnectedPlayers([]);
    setChatMessages([]);
    setPointerLockedOverride(false);
    
    if (hasError) {
      setErrorMessage(errorMsg || "Desconectado do servidor.");
      setPhase(ConnectionPhase.ERROR);
    } else {
      setPhase(ConnectionPhase.MENU);
    }
  };

  // Close tab trigger
  const handleCloseApp = () => {
    window.parent.location.href = "about:blank"; // Safe frame escape
  };

  return (
    <div className="w-full h-screen bg-[#020201] text-white relative select-none overflow-hidden font-mono">
      
      {/* PHASE 1: MAIN MENU */}
      {phase === ConnectionPhase.MENU && (
        <MainMenu
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onHost={connectToLobby}
          onJoin={connectToLobby}
          onCloseApp={handleCloseApp}
        />
      )}

      {/* PHASE 2: CONNECTING / WARMUPS */}
      {phase === ConnectionPhase.CONNECTING && (
        <div className="w-full h-screen flex flex-col items-center justify-center bg-[#070704] text-[#deb81d] px-6 select-none relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,20,10,0)_0%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />
          
          <div className="max-w-md w-full border border-[#a28e3b]/30 bg-[#14130a] p-8 rounded text-center relative space-y-6 shadow-2xl">
            <Loader2 className="w-12 h-12 text-[#deb81d] animate-spin mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold tracking-widest uppercase">CONECTANDO À FENDA...</h2>
              <p className="text-xs text-[#a28e3b] uppercase leading-relaxed">
                Estabilizando sinal de rádio e preparando geração do mapa do Level 0. Por favor, aguarde.
              </p>
            </div>
            <div className="text-[10px] bg-[#0b0a05] text-[#a28e3b]/70 border border-[#a28e3b]/10 py-2.5 rounded">
              SALA: {roomKeyFor(settings)}
            </div>
          </div>
        </div>
      )}

      {/* PHASE 3: GAMEPLAY SCREEN */}
      {phase === ConnectionPhase.PLAYING && (
        <div className="w-full h-screen relative">
          
          {/* Main Three.js container */}
          <div 
            id="threejs-viewport" 
            className="w-full h-full cursor-pointer absolute inset-0 z-10" 
          />

          {/* Creeping Crimson Silent Hazard Vignette */}
          {currentLevel === 0 && redRoomExposure > 0 && (
            <div 
              className="absolute inset-0 pointer-events-none z-30 transition-all duration-300 ease-out"
              style={{
                background: `radial-gradient(circle, rgba(0,0,0,0) 35%, rgba(120,4,4,${Math.min(0.85, 0.15 + (redRoomExposure / 60) * 0.7)}) 100%)`
              }}
            />
          )}

          {/* Locked Mouse Notice/Overlay */}
          {/* Locked Mouse Notice/Overlay (Custom Pause Menu with Diário) */}
          {!pointerLocked && !pointerLockedOverride && !isInventoryOpen && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#000000]/92 text-[#deb81d] z-50 text-center px-4 font-mono select-none">
              <div className="w-full max-w-3xl border border-[#a28e3b]/50 bg-[#14130a] rounded shadow-[0_0_50px_rgba(222,184,29,0.15)] flex flex-col h-[520px] max-h-[90vh] overflow-hidden pointer-events-auto">
                
                {/* Header with Navigation Tabs */}
                <div className="flex items-center justify-between border-b border-[#a28e3b]/30 bg-[#0c0b05]/95 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 bg-red-600 rounded-full animate-ping" />
                    <span className="font-extrabold text-sm tracking-widest uppercase">MENU DE PAUSA / TELEMETRIA</span>
                  </div>
                  
                  {/* Tabs */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPauseMenuTab("controles")}
                      className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                        pauseMenuTab === "controles"
                          ? "bg-[#deb81d] text-black border-[#deb81d]"
                          : "bg-black/40 text-[#a28e3b] border-transparent hover:border-[#a28e3b]/30"
                      }`}
                    >
                      Controles
                    </button>
                    <button
                      onClick={() => setPauseMenuTab("diario")}
                      className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer transition-all flex items-center gap-2 ${
                        pauseMenuTab === "diario"
                          ? "bg-[#deb81d] text-black border-[#deb81d]"
                          : "bg-black/40 text-[#a28e3b] border-transparent hover:border-[#a28e3b]/30"
                      }`}
                    >
                      Diário
                      {collectedNotes.length > 0 && (
                        <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                          pauseMenuTab === "diario" ? "bg-black text-[#deb81d]" : "bg-[#deb81d] text-black"
                        }`}>
                          {collectedNotes.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden flex bg-[#0c0b05]/30">
                  {pauseMenuTab === "controles" ? (
                    /* Controles Tab Content */
                    <div className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-6 overflow-y-auto">
                      <div className="flex-1 text-center md:text-left space-y-4">
                        <div className="flex items-center justify-center md:justify-start gap-2 text-[#deb81d]">
                          <HelpCircle className="w-8 h-8 animate-pulse" />
                          <h3 className="text-lg font-black uppercase tracking-wider">Controle Desfocado</h3>
                        </div>
                        <p className="text-xs text-[#a28e3b] uppercase leading-relaxed max-w-sm">
                          O cursor foi liberado. Clique na tela para retornar à infiltração 3D ou ative o modo de compatibilidade para jogar diretamente.
                        </p>
                        
                        <div className="space-y-3">
                          <button
                            id="btn-bypass-lock"
                            onClick={() => {
                              setPointerLockedOverride(true);
                              if (engineRef.current && engineRef.current.player) {
                                engineRef.current.player.isOverrideActive = true;
                              }
                            }}
                            className="w-full md:w-auto bg-[#deb81d] hover:bg-[#ebd255] text-black font-extrabold uppercase tracking-wider py-3 px-6 rounded text-xs transition-all cursor-pointer shadow-lg hover:shadow-[#deb81d]/10"
                          >
                            Ativar Jogabilidade Sem Trava
                          </button>
                          <p className="text-[10px] text-[#a28e3b]/60 uppercase tracking-wider">
                            (Arraste na tela para girar a câmera • WASD para mover)
                          </p>
                        </div>
                      </div>

                      <div className="w-full md:w-[320px] text-xs text-left text-[#a28e3b]/85 bg-[#0b0a05] border border-[#a28e3b]/20 p-5 rounded space-y-2.5 shadow-inner">
                        <div className="font-extrabold border-b border-[#a28e3b]/25 pb-1.5 mb-2 text-[#deb81d] uppercase tracking-wider">
                          Guia de Operações
                        </div>
                        <div className="flex justify-between"><span>Mover Explorador</span><span className="text-[#deb81d] font-bold">W, A, S, D / Setas</span></div>
                        <div className="flex justify-between"><span>Olhar ao Redor</span><span className="text-[#deb81d] font-bold">Mover Mouse</span></div>
                        <div className="flex justify-between"><span>Correr</span><span className="text-[#deb81d] font-bold">L-SHIFT</span></div>
                        <div className="flex justify-between"><span>Agachar</span><span className="text-[#deb81d] font-bold">CTRL / C</span></div>
                        <div className="flex justify-between"><span>Lanterna</span><span className="text-[#deb81d] font-bold">F</span></div>
                        <div className="flex justify-between"><span>Inventário</span><span className="text-[#deb81d] font-bold">I</span></div>
                        <div className="flex justify-between"><span>Conquistas</span><span className="text-[#deb81d] font-bold">K</span></div>
                        <div className="flex justify-between"><span>Liberar Mouse</span><span className="text-[#deb81d] font-bold">ESC</span></div>
                      </div>
                    </div>
                  ) : (
                    /* Diário / Journal Tab Content */
                    <div className="flex-1 flex overflow-hidden">
                      {/* Sidebar list of notes */}
                      <div className="w-[240px] border-r border-[#a28e3b]/20 bg-black/40 flex flex-col">
                        <div className="p-3 border-b border-[#a28e3b]/10 text-[10px] text-[#a28e3b] uppercase font-bold tracking-widest text-center bg-[#14130a]/50">
                          LOGS DE ATIVIDADE ({collectedNotes.length})
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-[#a28e3b]/10 scrollbar-thin scrollbar-thumb-amber-500/20">
                          {collectedNotes.length === 0 ? (
                            <div className="p-4 text-center text-[10px] text-[#a28e3b]/50 italic uppercase leading-relaxed pt-12">
                              Nenhum fragmento coletado neste ciclo.
                            </div>
                          ) : (
                            collectedNotes.map((note) => {
                              const isSelected = selectedJournalNote?.title === note.title || (!selectedJournalNote && collectedNotes[0]?.title === note.title);
                              return (
                                <button
                                  key={note.title}
                                  onClick={() => setSelectedJournalNote(note)}
                                  className={`w-full text-left p-3.5 transition-all flex flex-col gap-1.5 cursor-pointer ${
                                    isSelected
                                      ? "bg-[#deb81d]/10 border-l-4 border-[#deb81d]"
                                      : "hover:bg-white/[0.02] border-l-4 border-transparent"
                                  }`}
                                >
                                  <div className={`text-xs font-black uppercase tracking-wider truncate ${isSelected ? "text-[#deb81d]" : "text-stone-300"}`}>
                                    {note.title}
                                  </div>
                                  <div className="text-[9px] text-[#a28e3b]/70 flex justify-between uppercase">
                                    <span>{note.author.split(" ")[0]}</span>
                                    <span>{note.date.split(" ")[0]}</span>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Detail view of selected note */}
                      <div className="flex-1 flex flex-col bg-black/10 overflow-hidden relative">
                        {/* Accent paper glow */}
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(222,184,29,0.02)_0%,rgba(0,0,0,0.5)_100%)] pointer-events-none" />
                        
                        {(() => {
                          const activeNote = selectedJournalNote || collectedNotes[0];
                          if (!activeNote) {
                            return (
                              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
                                <FileText className="w-12 h-12 text-[#a28e3b]/30 animate-pulse" />
                                <div className="space-y-1">
                                  <h4 className="text-xs font-bold text-[#deb81d] uppercase tracking-widest">Diário Vazio</h4>
                                  <p className="text-[10px] text-[#a28e3b]/70 uppercase max-w-xs leading-relaxed">
                                    Encontre os fragmentos de papéis flutuantes (Scrap of Note) nas salas para extrair registros antigos de sobreviventes.
                                  </p>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="flex-1 flex flex-col p-6 overflow-hidden z-10 text-left">
                              {/* Metadata */}
                              <div className="border-b border-[#a28e3b]/25 pb-3 mb-4 space-y-1 bg-black/25 p-3 rounded border border-[#a28e3b]/10">
                                <div className="flex justify-between items-center text-[10px] text-[#a28e3b] font-bold">
                                  <span>AUTOR: <span className="text-stone-200">{activeNote.author}</span></span>
                                  <span>REGISTRO: <span className="text-stone-200">{activeNote.date}</span></span>
                                </div>
                                <div className="text-[10px] text-[#a28e3b] font-bold truncate uppercase flex items-center gap-1">
                                  <Compass className="w-3 h-3 text-[#deb81d]" />
                                  <span>LOCAL: <span className="text-[#deb81d]">{activeNote.location}</span></span>
                                </div>
                              </div>

                              {/* Document content */}
                              <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-amber-500/20 text-stone-200/90 text-xs leading-relaxed font-serif italic whitespace-pre-wrap selection:bg-[#deb81d] selection:text-black">
                                {activeNote.content}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer close info */}
                <div className="border-t border-[#a28e3b]/20 bg-[#0c0b05]/95 px-6 py-3.5 flex justify-between items-center">
                  <span className="text-[9px] text-[#a28e3b] uppercase">Pressione [ESC] ou clique fora para retornar à infiltração</span>
                  <button
                    onClick={() => {
                      // Lock mouse back or trigger override if pointer lock is unavailable
                      const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement;
                      if (canvasEl) {
                        canvasEl.requestPointerLock();
                      } else {
                        setPointerLockedOverride(true);
                      }
                    }}
                    className="bg-[#deb81d] hover:bg-[#ebd255] text-black font-black uppercase tracking-wider px-5 py-2 rounded cursor-pointer transition-all text-xs"
                  >
                    Retomar Infiltração
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* Retro terminal-style map loading overlay ("Só deixe jogar quando o mapa carregar completamente") */}
          {loadingMap && (
            <div className="absolute inset-0 bg-[#0c0b05] z-50 flex flex-col items-center justify-center font-mono text-[#deb81d] px-6 select-none text-center">
              {/* Ambient scanlines and glow */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(25,25,10,0.1)_0%,rgba(0,0,0,0.92)_100%)] pointer-events-none" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[size:100%_4px] pointer-events-none opacity-20" />
              
              <div className="max-w-md w-full border border-[#a28e3b]/30 bg-[#14130a]/95 p-8 rounded shadow-2xl relative space-y-6">
                <div className="text-left space-y-1">
                  <div className="text-[10px] text-[#a28e3b]/60 uppercase tracking-widest font-extrabold select-none">
                    Inicializando Fenda Dimensional...
                  </div>
                   <h2 className="text-lg font-black tracking-widest text-[#deb81d] uppercase select-none flex items-center justify-between">
                    <span>DESCOMPRIMINDO LEVEL {currentLevel}</span>
                    <span className="text-[#a28e3b] text-sm font-semibold">{loadingProgress}%</span>
                  </h2>
                </div>

                {/* Retro yellow bar progress loading container */}
                <div className="w-full h-4 bg-black/60 border border-[#a28e3b]/30 p-0.5 rounded overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#b39a3c] to-[#deb81d] transition-all duration-100 ease-out rounded-sm shadow-[0_0_8px_rgba(222,184,29,0.3)]"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>

                {/* Fake loading logging sequences */}
                <div className="text-[10px] text-[#a28e3b] border border-[#a28e3b]/10 bg-[#090804] px-4 py-3 rounded text-left space-y-1 h-28 overflow-hidden select-text text-[11px] tracking-wide">
                  <div className={loadingProgress >= 5 ? "opacity-100" : "opacity-0"}>[OK] Conectando ao terminal de infiltração...</div>
                  <div className={loadingProgress >= 28 ? "opacity-100 animate-pulse" : "opacity-0"}>[OK] Sincronizando com a semente {currentSeed}...</div>
                  <div className={loadingProgress >= 50 ? "opacity-100 font-bold" : "opacity-0"}>
                    {currentLevel === 1 
                      ? "[OK] Construindo usinas termoelétricas de concreto e encanamentos brutais..." 
                      : "[OK] Gerando labirinto infinito de papel de parede..."
                    }
                  </div>
                  <div className={loadingProgress >= 72 ? "opacity-100" : "opacity-0"}>
                    {currentLevel === 1 
                      ? "[OK] Distribuição de tonéis industriais e vazamentos de vapor estocásticos..." 
                      : "[OK] Construindo marcadores de emergência no carpete..."
                    }
                  </div>
                  <div className={loadingProgress >= 92 ? "opacity-100" : "opacity-0"}>
                    {currentLevel === 1 
                      ? "[OK] Injetando ruídos industriais e drone pesado de caldeira..." 
                      : "[OK] Canal de áudio fluorescente ativo (60Hz Subhum)..."
                    }
                  </div>
                </div>

                <div className="text-[9px] text-[#a28e3b]/50 uppercase tracking-widest leading-relaxed">
                  Não mude de guia. O noclip dimensional está sendo calibrado.
                </div>
              </div>
            </div>
          )}

          {/* Foreground HUD dashboard */}
          <GameHUD
            stamina={stamina}
            sanity={sanity}
            isFlashlightOn={isFlashlightOn}
            playerState={playerState}
            playerName={settings.name}
            roomKey={roomKeyFor(settings)}
            connectedPlayers={connectedPlayers}
            playersRef={playersRef}
            perf={perf}
            showFps={settings.showFps}
            chatMessages={chatMessages}
            onSendMessage={handleSendMessage}
            onDisconnect={() => disconnect(false)}
            level={currentLevel}
            engineRef={engineRef}
            currentSector={currentSector}
            hudNotification={hudNotification}
            notificationKey={notificationKey}
            onOpenInventory={() => setIsInventoryOpen(true)}
            inventoryCount={inventory.length}
            onOpenAchievements={() => setIsAchievementsOpen(true)}
          />

          <InventoryHUD
            inventory={inventory}
            isOpen={isInventoryOpen}
            onClose={() => setIsInventoryOpen(false)}
            onUseItem={(itemId) => {
              if (engineRef.current) {
                engineRef.current.useInventoryItem(itemId);
              }
            }}
          />

          <AchievementsHUD
            isOpen={isAchievementsOpen}
            onClose={() => setIsAchievementsOpen(false)}
          />

          {/* Achievement Unlock Popup Toast */}
          {achievementToast && (
            <div className="fixed top-6 right-6 z-50 pointer-events-none font-mono animate-bounce">
              <div className="bg-[#0b0b05]/95 border-2 border-[#deb81d] rounded px-5 py-4 flex items-center gap-4 shadow-[0_0_25px_rgba(222,184,29,0.35)] max-w-sm">
                <div className="p-2 bg-[#deb81d]/15 border border-[#deb81d] rounded animate-pulse">
                  <Trophy className="w-5 h-5 text-[#deb81d]" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#a28e3b] font-bold">Conquista Desbloqueada!</div>
                  <div className="text-xs font-black uppercase text-[#ebd255] tracking-wider mt-0.5">{(achievementToast as any).title}</div>
                  <div className="text-[9px] text-stone-300 font-sans mt-1 leading-tight">{(achievementToast as any).description}</div>
                </div>
              </div>
            </div>
          )}

          {/* Scrap of Note Lore Popup Modal */}
          {activeLoreNote && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm select-none font-mono">
              <div 
                id="lore-note-modal"
                className="relative w-full max-w-xl bg-[#1e1c14] border-2 border-[#deb81d]/50 rounded p-6 sm:p-8 shadow-[0_0_50px_rgba(222,184,29,0.15)] flex flex-col gap-6"
              >
                {/* Paper texture aesthetics */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(222,184,29,0.03)_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none rounded" />
                
                {/* Header */}
                <div className="flex justify-between items-start border-b border-[#a28e3b]/30 pb-4 z-10">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-400/10 border border-[#deb81d]/30 rounded">
                      <FileText className="w-5 h-5 text-[#deb81d]" />
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-[#a28e3b]">Documento Encontrado</div>
                      <h3 className="text-sm font-black text-[#deb81d] uppercase tracking-wider">{activeLoreNote.title}</h3>
                    </div>
                  </div>
                  <button
                    id="btn-close-lore-note"
                    onClick={() => {
                      setActiveLoreNote(null);
                      if (engineRef.current && engineRef.current.player) {
                        engineRef.current.player.mapFullyLoaded = true;
                      }
                    }}
                    className="p-1 hover:bg-[#deb81d]/10 border border-transparent hover:border-[#deb81d]/30 rounded transition-all cursor-pointer pointer-events-auto"
                  >
                    <X className="w-5 h-5 text-[#deb81d]" />
                  </button>
                </div>

                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 bg-black/30 border border-[#a28e3b]/10 p-3 rounded text-[10px] z-10 text-stone-300">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#a28e3b] font-bold">AUTOR:</span>
                    <span className="truncate">{activeLoreNote.author}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#a28e3b] font-bold">DATA:</span>
                    <span>{activeLoreNote.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5 col-span-2">
                    <Compass className="w-3.5 h-3.5 text-[#a28e3b]" />
                    <span className="text-[#a28e3b] font-bold">LOCALIZAÇÃO REGISTRADA:</span>
                    <span className="text-[#deb81d]">{activeLoreNote.location}</span>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto max-h-[300px] pr-2 scrollbar-thin scrollbar-thumb-amber-500/20 z-10">
                  <p className="text-xs sm:text-sm text-amber-100/90 leading-relaxed font-serif italic whitespace-pre-wrap selection:bg-[#deb81d] selection:text-black">
                    {activeLoreNote.content}
                  </p>
                </div>

                {/* Footer instructions */}
                <div className="border-t border-[#a28e3b]/20 pt-4 flex justify-between items-center z-10 text-[9px] text-[#a28e3b]">
                  <span className="animate-pulse">▲ INSIGHT ADQUIRIDO</span>
                  <button
                    onClick={() => {
                      setActiveLoreNote(null);
                      if (engineRef.current && engineRef.current.player) {
                        engineRef.current.player.mapFullyLoaded = true;
                      }
                    }}
                    className="bg-[#deb81d] hover:bg-[#ebd255] text-black font-black uppercase px-4 py-2 rounded cursor-pointer transition-all pointer-events-auto text-[10px]"
                  >
                    CONCLUIR LEITURA
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* PHASE 4: DISCONNECTS OR CRITICAL FAULTS */}
      {phase === ConnectionPhase.ERROR && (
        <div className="w-full h-screen flex flex-col items-center justify-center bg-[#070704] text-[#deb81d] px-6 select-none relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,20,10,0)_0%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />

          <div className="max-w-md w-full border border-red-500/20 bg-[#1c0808]/92 p-8 rounded text-center relative space-y-6 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-lg font-bold tracking-widest text-[#deb81d] uppercase">SINAL INTERROMPIDO</h2>
              <p className="text-xs text-red-400 uppercase leading-relaxed">
                {errorMessage || "Não foi possível manter contato com a fenda espaço-temporal do Level 0."}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                id="btn-error-menu"
                onClick={() => setPhase(ConnectionPhase.MENU)}
                className="flex-1 bg-transparent border border-red-500/40 hover:bg-red-500/10 text-red-400 py-3 rounded text-xs uppercase tracking-wider font-semibold transition-colors cursor-pointer"
              >
                Menu Principal
              </button>
              <button
                id="btn-error-retry"
                onClick={connectToLobby}
                className="flex-1 flex items-center justify-center gap-2 bg-[#deb81d] hover:bg-[#ebd255] text-black py-3 rounded text-xs uppercase tracking-wider font-bold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Repetir Tentativa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 5: SUCCESSFUL ESCAPE / VICTORY SCREEN */}
      {phase === ConnectionPhase.ESCAPED && (
        <div className="w-full h-screen flex flex-col items-center justify-center bg-[#050604] text-[#deb81d] px-6 select-none relative animate-fade-in font-mono">
          {/* Subtle emergency scanline overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(10,35,10,0.15)_0%,rgba(0,0,0,0.95)_100%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,6px_100%] pointer-events-none opacity-45" />

          {currentLevel === 1 ? (
            <div className="max-w-xl w-full border border-orange-600/30 bg-[#140b05]/92 p-8 rounded text-center relative space-y-6 shadow-[0_0_25px_rgba(234,88,12,0.15)] animate-fade-in">
              <div className="w-16 h-16 bg-orange-950/60 border border-orange-500/50 rounded-full flex items-center justify-center mx-auto relative animate-pulse">
                <span className="w-12 h-12 bg-orange-500 rounded-full animate-ping absolute opacity-20" />
                <HelpCircle className="w-8 h-8 text-orange-500 rotate-180" />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-2xl font-black tracking-widest text-orange-400 uppercase">LEVEL 2 ALCANÇADO: PIPE DREAMS</h2>
                
                <div className="p-4 bg-black/60 border border-orange-950/60 rounded text-left space-y-3 text-xs leading-relaxed font-sans text-gray-300">
                  <div className="font-bold text-orange-400 border-b border-orange-950/60 pb-1 font-mono uppercase tracking-widest">
                    DESCRIÇÃO DO SETOR (LEVEL 2):
                  </div>
                  <p>
                    Level 2, commonly known as "Pipe Dreams", is the 3rd level of the Backrooms. It features endless concrete maintenance tunnels lined with hot pipes, intense heat, and a high presence of hostile entities. Survival is classified as Class 2 (Unsafe), demanding constant vigilance to avoid boiling steam, dangerous entities, and extreme temperatures.
                  </p>
                </div>
                
                <div className="p-4 bg-black/60 border border-orange-950/60 rounded text-left space-y-1.5 text-xs text-[#a28e3b]/80 font-mono">
                  <div className="font-bold text-orange-400 border-b border-orange-950/60 pb-1 mb-1 uppercase">
                    RELATÓRIO DE INFILTRAÇÃO:
                  </div>
                  <div>• STATUS DO EXPEDICIONÁRIO: <span className="text-orange-400 font-bold">VIVO / SOB COAÇÃO</span></div>
                  <div>• DESTINO ALCANÇADO: <span className="text-white">LEVEL 2 (PIPE DREAMS)</span></div>
                  <div>• SINAL DE CONTATO VIRTUAL: <span className="text-[#deb81d]">{settings.name}</span></div>
                  <div>• SEED DE GERAÇÃO: <span className="text-gray-400">{currentSeed}</span></div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="btn-escaped-return-l2"
                  onClick={() => setPhase(ConnectionPhase.MENU)}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-black font-extrabold uppercase tracking-widest py-3 rounded text-xs transition-colors cursor-pointer shadow-lg hover:shadow-orange-600/10"
                >
                  Voltar ao Menu Principal
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-xl w-full border border-green-600/30 bg-[#0a180a]/92 p-8 rounded text-center relative space-y-6 shadow-[0_0_25px_rgba(34,197,94,0.15)]">
              <div className="w-16 h-16 bg-green-950/60 border border-green-500/50 rounded-full flex items-center justify-center mx-auto relative animate-pulse">
                <span className="w-12 h-12 bg-green-500 rounded-full animate-ping absolute opacity-20" />
                <HelpCircle className="w-8 h-8 text-green-500 rotate-180" />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-2xl font-black tracking-widest text-green-400 uppercase">INFILTRAÇÃO CONCLUÍDA</h2>
                <p className="text-sm text-green-300 uppercase leading-relaxed font-sans">
                  Parabéns! Você encontrou o ponto de escape e conseguiu romper as barreiras dimensionais do <span className="text-[#deb81d] font-bold">Level 0: The Backrooms</span>, retornando em segurança à realidade conhecida.
                </p>
                
                <div className="p-4 bg-black/60 border border-green-950/60 rounded text-left space-y-1.5 text-xs text-[#a28e3b]/80">
                  <div className="font-bold text-green-400 border-b border-green-950/60 pb-1 mb-1">
                    RELATÓRIO DE EXTRAÇÃO:
                  </div>
                  <div>• STATUS DO EXPEDICIONÁRIO: <span className="text-green-400 font-bold">VIVO E SEGURO</span></div>
                  <div>• SETOR RETOMADO: <span className="text-white">COUT-SPACE L0-45</span></div>
                  <div>• SINAL DE CONTATO VIRTUAL: <span className="text-[#deb81d]">{settings.name}</span></div>
                  <div>• SEED DE GERAÇÃO: <span className="text-gray-400">{currentSeed}</span></div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="btn-escaped-return"
                  onClick={() => setPhase(ConnectionPhase.MENU)}
                  className="w-full bg-green-600 hover:bg-green-500 text-black font-extrabold uppercase tracking-widest py-3 rounded text-xs transition-colors cursor-pointer shadow-lg hover:shadow-green-600/10"
                >
                  Voltar ao Menu Principal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE 6: GAME OVER SCREEN */}
      {phase === ConnectionPhase.GAME_OVER && (
        <div className="w-full h-screen flex flex-col items-center justify-center bg-[#090303] text-red-500 px-6 select-none relative animate-fade-in font-mono">
          {/* Bleak blood vignette overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(80,0,0,0.3)_0%,rgba(0,0,0,0.98)_100%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.08),rgba(0,0,0,0),rgba(255,0,0,0.08))] bg-[size:100%_4px,6px_100%] pointer-events-none opacity-60" />

          <div className="max-w-xl w-full border border-red-950 bg-black/90 p-8 rounded text-center relative space-y-6 shadow-[0_0_40px_rgba(220,38,38,0.2)]">
            <div className="w-16 h-16 bg-red-950/40 border border-red-500/40 rounded-full flex items-center justify-center mx-auto relative animate-pulse">
              <span className="w-12 h-12 bg-red-600 rounded-full animate-ping absolute opacity-10" />
              <Skull className="w-8 h-8 text-red-600" />
            </div>
            
            <div className="space-y-4">
              <h2 className="text-3xl font-black tracking-[0.25em] text-red-600 uppercase animate-pulse">SANIDADE ZERO</h2>
              <p className="text-xs text-stone-400 uppercase leading-relaxed font-sans max-w-md mx-auto">
                Sua mente sucumbiu ao terror absoluto dos Backrooms. A realidade se desfez, restando apenas um vazio silencioso no labirinto infinito de paredes amarelas.
              </p>
              
              <div className="p-4 bg-red-950/10 border border-red-950 rounded text-left space-y-2 text-xs text-stone-400 font-mono">
                <div className="font-bold text-red-500 border-b border-red-950/60 pb-1 mb-1 uppercase tracking-wider">
                  RELATÓRIO POST-MORTEM:
                </div>
                <div>• STATUS DO EXPLORADOR: <span className="text-red-600 font-bold">REPROVADO / PERDIDO</span></div>
                <div>• ÚLTIMO LOCAL REGISTRADO: <span className="text-white">LEVEL {currentLevel} ({currentLevel === 0 ? "THE BACKROOMS" : currentLevel === 1 ? "HABITABLE ZONE" : "PIPE DREAMS"})</span></div>
                <div>• IDENTIFICADOR: <span className="text-stone-300">{settings.name}</span></div>
                <div>• SEED DA SESSÃO: <span className="text-stone-300 font-bold">{currentSeed}</span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                id="btn-gameover-restart"
                onClick={() => {
                  setSanity(1.0);
                  setStamina(1.0);
                  setCurrentLevel(0);
                  setInventory([]);
                  setCollectedNotes([]);
                  // Reconnect using the EXACT same seed
                  connectToLobby(currentSeed);
                }}
                className="w-full bg-red-700 hover:bg-red-600 text-white font-extrabold uppercase tracking-widest py-3 px-4 rounded text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 border border-red-600/30"
              >
                <RefreshCw className="w-4 h-4 animate-spin-slow" />
                Reiniciar (Mesmo Seed)
              </button>

              <button
                id="btn-gameover-menu"
                onClick={() => setPhase(ConnectionPhase.MENU)}
                className="w-full bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-300 font-extrabold uppercase tracking-widest py-3 px-4 rounded text-xs transition-colors cursor-pointer border border-stone-800"
              >
                Menu Principal
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

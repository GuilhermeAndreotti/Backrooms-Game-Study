/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { GameSettings, ConnectionPhase, RemotePlayer, ChatMessage, DEFAULT_SUIT_COLOR, RoomConfig, DeathAction, ROOM_CHEATS, SUDO_CHEAT, type RoomCheat } from "./types/game";
import { GameEngine, LevelGProgress } from "./game/GameEngine";
import { MainMenu } from "./components/MainMenu";
import { GameHUD } from "./components/GameHUD";
import { InventoryHUD } from "./components/InventoryHUD";
import { AchievementsHUD } from "./components/AchievementsHUD";
import { TerminalModal } from "./components/TerminalModal";
import { CheatTerminalModal, SkinChoice } from "./components/CheatTerminalModal";
import { PauseSettings } from "./components/PauseSettings";
import { LevelSelectorModal } from "./components/LevelSelectorModal";
import { MegDoorModal } from "./components/MegDoorModal";
import { FunPanelModal } from "./components/FunPanelModal";
import { AdSlot } from "./components/AdSlot";
import { LOBBY_LEVEL, FUN_LEVEL, LEVEL_G, LIGHTS_OUT_LEVEL, ELECTRICAL_ROOM_LEVEL, ABANDONED_OFFICE_LEVEL, POOLROOMS_LEVEL, MOTION_LEVEL, nextMainLevel } from "./game/levels/constants";
import { addAchievementListener, removeAchievementListener, unlockAchievement } from "./utils/achievements";
import { isTypingInField, lockGameInput } from "./utils/input";
import { EMPTY_FACE } from "./utils/face";
import { BackroomsLore, generateProceduralLore } from "./utils/lore";
import { t, useLanguage, localeTag } from "./i18n";
import { Loader2, AlertCircle, RefreshCw, HelpCircle, Trophy, FileText, Compass, Skull } from "lucide-react";

/**
 * Player-facing level label. Internal level ids and what's shown on screen
 * are deliberately decoupled (Lights Out is internal id 6, shown as
 * "6 · LIGHTS OUT" per Backrooms-wiki lore numbering) — this keeps every
 * such special case in one place instead of scattered ternaries.
 */
function displayLabelForLevel(level: number): string {
  if (level === ELECTRICAL_ROOM_LEVEL) return "LEVEL 3 · ELECTRICAL ROOM";
  if (level === ABANDONED_OFFICE_LEVEL) return "LEVEL 4 · ABANDONED OFFICE";
  if (level === POOLROOMS_LEVEL) return "POOLROOMS";
  if (level === LOBBY_LEVEL) return "LOBBY";
  if (level === LIGHTS_OUT_LEVEL) return "6 · SECRET";
  if (level === LEVEL_G) return "LEVEL G · SECRET";
  if (level === MOTION_LEVEL) return "MOTION";
  if (level === FUN_LEVEL) return "LEVEL FUN";
  return String(level);
}

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
  showFps: true,
  suitColor: DEFAULT_SUIT_COLOR,
  face: EMPTY_FACE,
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

/** Room code from an invite link path (yoursite/AB4D3X), or "". */
function roomCodeFromUrl(): string {
  const m = window.location.pathname.match(/^\/([A-Za-z0-9]{4,12})\/?$/);
  return m ? m[1].toUpperCase() : "";
}

/** How to enter the relay: make a new room, or join one by its invite code. */
type JoinRequest = { create: true } | { code: string };

function inviteLink(code: string): string {
  return `${window.location.origin}/${code}`;
}


/** The terminal code that unlocks each room cheat, for the chat announcement. */
const CHEAT_CODES: Record<RoomCheat | typeof SUDO_CHEAT, string> = { speed: "MVJM", stamina: "UHUM", clip: "CLIP", life: "LIFE", arrow: "SETA", sudo: "SUDO" };

/** Keeps only known cheat ids from a server message. */
function sanitizeRoomCheats(value: unknown): RoomCheat[] {
  return Array.isArray(value) ? value.filter((c): c is RoomCheat => (ROOM_CHEATS as readonly unknown[]).includes(c)) : [];
}

export default function App() {
  useLanguage(); // re-render everything when the language changes
  const [settings, setSettings] = useState<GameSettings>(defaultSettings);
  const [phase, setPhase] = useState<ConnectionPhase>(ConnectionPhase.MENU);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentSeed, setCurrentSeed] = useState<number>(0);
  
  // Real-time telemetry feeding from Game loop
  const [stamina, setStamina] = useState(1.0);
  const [sanity, setSanity] = useState(1.0);
  // Death: a dead explorer spectates a living teammate; when everyone is dead
  // the group picks how the room starts over.
  // Room: invite code, who hosts (starts the expedition from the lobby)
  const [roomCode, setRoomCode] = useState("");
  const [hostId, setHostId] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteCode] = useState(() => roomCodeFromUrl());
  const lastJoinRef = useRef<JoinRequest>({ create: true });
  const hostIdRef = useRef("");
  const [isDead, setIsDead] = useState(false);
  const [spectateName, setSpectateName] = useState<string | null>(null);
  const [allDead, setAllDead] = useState(false);
  const [exitProgress, setExitProgress] = useState<{ level: number; ready: number; required: number } | null>(null);
  const [waitingForExit, setWaitingForExit] = useState(false);
  const [roomConfig, setRoomConfig] = useState<RoomConfig>({ deathAction: "current_level", secretRoutes: true });
  const roomConfigRef = useRef(roomConfig);
  useEffect(() => { roomConfigRef.current = roomConfig; }, [roomConfig]);
  const [isFlashlightOn, setIsFlashlightOn] = useState(false);
  const [playerState, setPlayerState] = useState("idle");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockedOverride, setPointerLockedOverride] = useState(false);
  const [redRoomExposure, setRedRoomExposure] = useState(0);
  const [toxicWaterExposure, setToxicWaterExposure] = useState(0);
  const [currentSector, setCurrentSector] = useState("");
  const [inventory, setInventory] = useState<string[]>([]);
  const [activeLoreNote, setActiveLoreNote] = useState<BackroomsLore | null>(null);
  const [collectedNotes, setCollectedNotes] = useState<BackroomsLore[]>([]);
  const [pauseMenuTab, setPauseMenuTab] = useState<"controles" | "diario" | "config">("controles");
  const [selectedJournalNote, setSelectedJournalNote] = useState<BackroomsLore | null>(null);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
  // Level G: documents found / alarm state, the terminal overlay, and the
  // special ending shown before the regular victory screen.
  const [levelGProgress, setLevelGProgress] = useState<LevelGProgress>({ digits: [null, null, null], alarm: false });
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isMegDoorOpen, setIsMegDoorOpen] = useState(false);
  const [isFunPanelOpen, setIsFunPanelOpen] = useState(false);
  const [funObjective, setFunObjective] = useState<string | null>(null);
  /** Level the explorer last escaped from, so the report can tell FUN's ending apart. */
  const [escapedFrom, setEscapedFrom] = useState<number | null>(null);
  const [megDialogue, setMegDialogue] = useState<{ name: string; grade: string; dialogue: string } | null>(null);
  // Lobby cheat terminal: MVJM/UHUM/CLIP/SKIN. cheatSkin only mirrors the
  // engine's own state for the picker's checkmark — GameEngine.cheatSkin
  // (replicated to teammates) is the source of truth.
  const [isCheatTerminalOpen, setIsCheatTerminalOpen] = useState(false);
  const [isLevelSelectorOpen, setIsLevelSelectorOpen] = useState(false);
  const [cheatSkin, setCheatSkin] = useState<SkinChoice | null>(null);
  const [isNoclipActive, setIsNoclipActive] = useState(false);
  const [voipEnabled, setVoipEnabled] = useState(false);
  const [voipSpeaking, setVoipSpeaking] = useState(false);
  const [interactPrompt, setInteractPrompt] = useState<string | null>(null);
  const [levelGEnding, setLevelGEnding] = useState<"none" | "message" | "done">("none");
  /**
   * The extraction report shown over the game when an expedition ends while
   * still connected: the room's lobby loads underneath, and closing it keeps
   * the explorer in the room (only "leave room" ever disconnects).
   */
  const [escapeReport, setEscapeReport] = useState<null | "l2" | "done">(null);
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
  // Round-trip latency to the relay, in ms — measured for real via ping/pong.
  const [latency, setLatency] = useState<number | undefined>(undefined);

  // Core references
  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  /**
   * Authoritative roster, mutated at network rate. `connectedPlayers` is a slow
   * mirror of this used only for rendering text; the radar reads the ref.
   */
  const playersRef = useRef<RemotePlayer[]>([]);
  const rosterDirtyRef = useRef(false);
  /** Own player id, read inside socket handlers without re-subscribing. */
  const clientIdRef = useRef<string | null>(null);
  /** Latest level -> world-authority map from the server (see server.ts). */
  const worldAuthorityRef = useRef<Record<string, string>>({});

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

  const megDialogueRef = useRef(megDialogue);
  megDialogueRef.current = megDialogue;
  const activeLoreNoteRef = useRef(activeLoreNote);
  activeLoreNoteRef.current = activeLoreNote;
  const loreNoteScrollRef = useRef<HTMLDivElement>(null);

  /** Closes whichever in-game reading overlay (MEG dialogue / exit paper) is open. */
  const closeReading = () => {
    setMegDialogue(null);
    setActiveLoreNote(null);
    engineRef.current?.endReading();
  };

  /**
   * E on an interactable. tryInteract() has side effects (it opens the MEG
   * dialogue, flips switches), so it runs exactly once per key press.
   * Returns whether the key was consumed.
   */
  const handleInteract = (): boolean => {
    const engine = engineRef.current;
    if (!engine) return false;
    switch (engine.tryInteract()) {
      case "meg_employee":
        // The dialogue itself arrives through onMegDialogue; it's read in-game,
        // pointer lock kept.
        return true;
      case "meg_door":
        setIsMegDoorOpen(true);
        document.exitPointerLock?.();
        return true;
      case "fun":
        // Something on Level FUN was picked up, placed or opened.
        return true;
      case "fun_panel":
        setIsFunPanelOpen(true);
        document.exitPointerLock?.();
        return true;
      case "terminal":
        // Level G's terminal
        setIsInventoryOpen(false);
        setIsAchievementsOpen(false);
        setIsTerminalOpen(true);
        document.exitPointerLock?.();
        return true;
      case "cheat":
        // The lobby's cheat terminal
        setIsInventoryOpen(false);
        setIsAchievementsOpen(false);
        setIsCheatTerminalOpen(true);
        document.exitPointerLock?.();
        return true;
      case "paper": {
        // The paper on the exit desk — read in-game, pointer lock kept.
        const note = engine.exitPaperNote();
        if (note) {
          setActiveLoreNote({
            title: note.title,
            author: t("note.paperAuthor"),
            date: "—",
            location: `Level ${engine.level}`,
            content: note.content,
          });
        } else {
          engine.endReading();
        }
        return true;
      }
      default:
        return false;
    }
  };

  // Long papers scroll with the mouse wheel: wheel events still fire while
  // the pointer is locked, the cursor just can't hover the panel.
  useEffect(() => {
    if (!activeLoreNote) return;
    const onWheel = (e: WheelEvent) => {
      loreNoteScrollRef.current?.scrollBy({ top: e.deltaY });
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [activeLoreNote]);

  // Keyboard listener for toggling inventory & achievements
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (phase !== ConnectionPhase.PLAYING) return;
        // Ctrl+W is the browser's close-tab shortcut, but Ctrl is also crouch.
        if (e.ctrlKey && e.key.toLowerCase() === "w") e.preventDefault();
      // Typing a chat message: "i"/"k" should land in the message, not pop
      // open the inventory/achievements panels over it.
      if (isTypingInField()) return;
      // Reading a MEG dialogue / exit paper: E closes it (the pointer stays
      // locked the whole time, so the game never drops into the pause menu).
      if ((e.key === "e" || e.key === "E") && (megDialogueRef.current || activeLoreNoteRef.current)) {
        e.preventDefault();
        if (!e.repeat) closeReading();
        return;
      }
      // Lobby: the host starts the expedition.
      if (e.key === "Enter" && !e.repeat && engineRef.current?.level === LOBBY_LEVEL && clientIdRef.current && clientIdRef.current === hostIdRef.current
        && !playersRef.current.some((p) => p.id !== clientIdRef.current && p.level !== undefined && p.level !== LOBBY_LEVEL)) {
        e.preventDefault();
        socketRef.current?.send(JSON.stringify({ type: "start_game", level: 0 }));
        return;
      }
      // Spectating: arrows flip between the teammates still alive.
      if (engineRef.current?.isDead && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        engineRef.current.cycleSpectate(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
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
      } else if ((e.key === "e" || e.key === "E") && !e.repeat && handleInteract()) {
        e.preventDefault();
      } else if ((e.key === "e" || e.key === "E") && !e.repeat && engineRef.current?.tryPushBox()) {
        // Shove the box in front of you out of the way
        e.preventDefault();
      } else if ((e.key === "e" || e.key === "E") && !e.repeat && engineRef.current?.tryTurnValve()) {
        // Level 7: turn the nearest untouched valve
        e.preventDefault();
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
      } else if (megDialogueRef.current || activeLoreNoteRef.current) {
        // Esc / alt-tab released the lock: close the reading overlay rather
        // than leave it stacked over the pause menu.
        closeReading();
      }
    };

    document.addEventListener("pointerlockchange", handleLock);
    return () => document.removeEventListener("pointerlockchange", handleLock);
  }, [phase]);

  // Back on the menu: forget the room and take its code out of the address bar.
  useEffect(() => {
    if (phase === ConnectionPhase.MENU) {
      setRoomCode("");
      setHostId("");
      try { window.history.replaceState(null, "", "/"); } catch { /* not critical */ }
    }
  }, [phase]);

  const copyInviteLink = () => {
    if (!roomCode) return;
    const link = inviteLink(roomCode);
    const done = () => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, done);
    else done();
  };

  hostIdRef.current = hostId;
  const isHost = !!clientId && clientId === hostId;
  /**
   * Back in the lobby on our own (we aborted) while teammates are still out on
   * the expedition: nothing can start until they come back too; we rejoin
   * them at their next level instead.
   */
  const expeditionRunning = currentLevel === LOBBY_LEVEL
    && connectedPlayers.some((p) => p.id !== clientId && p.level !== undefined && p.level !== LOBBY_LEVEL);

  // 2. Network connection setup
  const connectToLobby = (req: JoinRequest = { create: true }, forceSeed?: number) => {
    lastJoinRef.current = req;
    setPhase(ConnectionPhase.CONNECTING);
    setErrorMessage("");
    setChatMessages([]);
    setIsDead(false);
    setAllDead(false);
    setSpectateName(null);
    setConnectedPlayers([]);
    setCheatSkin(null);
    setIsCheatTerminalOpen(false);
    setIsNoclipActive(false);
    setVoipEnabled(false);
    setVoipSpeaking(false);
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
          ...("create" in req ? { create: true } : { room: req.code }),
          name: settings.name,
          suitColor: settings.suitColor,
          face: settings.face,
          requestedSeed: forceSeed,
        }));

        // Real round-trip latency for the HUD's PING readout — echoed straight
        // back by the server (see server.ts's "ping"/"pong" handling), not
        // routed through the room tick, so it reflects actual relay latency.
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
          }
        }, 4000);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type } = data;

          if (type === "pong") {
            if (typeof data.t === "number") setLatency(Date.now() - data.t);
          }

          else if (type === "room_not_found") {
            setErrorMessage(t("err.notFound"));
            setPhase(ConnectionPhase.ERROR);
            socket.close();
          }

          else if (type === "room_full") {
            setErrorMessage(data.reason === "server" ? t("err.serverFull") : t("err.roomCap", { n: data.capacity ?? 4 }));
            setPhase(ConnectionPhase.ERROR);
            socket.close();
          }

          else if (type === "joined") {
            const { id: myId, seed, players: currentOn, level: roomLevel = 0, authority = {}, code: joinedCode = "", hostId: joinedHost = "", roomConfig: joinedConfig, cheats: joinedCheats, poolroomsState } = data;
            // A server from before rooms/lobbies answers without an invite code
            // (and drops you straight into Level 0): say so instead of playing on.
            if (!joinedCode) {
              setErrorMessage(t("err.oldServer"));
              setPhase(ConnectionPhase.ERROR);
              socket.close();
              return;
            }
            worldAuthorityRef.current = authority;
            console.log(`Infiltration confirmed! Seed acquired: ${seed}. Connecting visuals...`);
            setClientId(myId);
            clientIdRef.current = myId;
            setLevelGEnding("none");
            setIsTerminalOpen(false);
            setIsDead(false);
            setAllDead(false);
            setExitProgress(null);
            setWaitingForExit(false);
            setSpectateName(null);
            playersRef.current = currentOn;
            setConnectedPlayers(currentOn);
            setCurrentSeed(seed);
            setRoomCode(joinedCode);
            setHostId(joinedHost);
            if (joinedConfig && typeof joinedConfig === "object") setRoomConfig(joinedConfig as RoomConfig);
            try { window.history.replaceState(null, "", `/${joinedCode}`); } catch { /* not critical */ }
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
                    onNoclipChange: (active) => setIsNoclipActive(active),
                    onVoipStateChange: (enabled) => setVoipEnabled(enabled),
                    onVoipSpeakingChange: (speaking) => setVoipSpeaking(speaking),
                    onEscapeTrigger: () => {
                      setRedRoomExposure(0);
                      setToxicWaterExposure(0);
                      const engine = engineRef.current;
                      if (!engine) return;

                      const nextLevel = nextMainLevel(engine.level);
                      if (nextLevel !== null) {
                        // Ask the server to advance the whole room together instead
                        // of transitioning just this client: previously each player
                        // who found the exit noclipped into their own next level,
                        // leaving the group split across levels. The actual
                        // transition now runs for every player (this one included)
                        // when the server's "level_transition" broadcast comes back
                        // — see that handler below.
                         if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                          socketRef.current.send(JSON.stringify({
                            type: "level_transition_request",
                             level: nextLevel,
                           }));
                         }
                      } else if (engine.level === POOLROOMS_LEVEL) {
                        socketRef.current?.send(JSON.stringify({ type: "level_transition_request", level: LOBBY_LEVEL }));
                      } else if (engine.level === LIGHTS_OUT_LEVEL && socketRef.current?.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: "level_transition_request", level: ELECTRICAL_ROOM_LEVEL, secret: true }));
                      } else if (engine.level === LEVEL_G && socketRef.current?.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: "level_transition_request", level: ABANDONED_OFFICE_LEVEL, secret: true }));
                      } else {
                        console.log("Explorer successfully escaped the Backrooms!");
                        unlockAchievement("absolute_survivor");
                        // Level G's emergency door is its own, secret ending
                           if (engine.level === LEVEL_G) {
                          unlockAchievement("level_g_escaped");
                          setLevelGEnding("message");
                        }
                        setIsTerminalOpen(false);
                        document.exitPointerLock?.();
                        if (socketRef.current?.readyState === WebSocket.OPEN) {
                          // Still in the room: show the report over the game and
                          // go back to the room's lobby underneath it.
                          setEscapedFrom(engine.level);
                          setEscapeReport(engine.level === 1 ? "l2" : "done");
                          socketRef.current.send(JSON.stringify({ type: "return_to_lobby_request" }));
                        } else {
                          setPhase(ConnectionPhase.ESCAPED);
                          if (engineRef.current) {
                            engineRef.current.destroy();
                            engineRef.current = null;
                          }
                          socketRef.current = null;
                        }
                      }
                    },
                    onInteractPrompt: (text) => setInteractPrompt(text),
                    onObjectiveChange: (text) => setFunObjective(text),
                    onMegDialogue: (employee) => setMegDialogue({ name: employee.name, grade: employee.grade, dialogue: employee.dialogue }),
                    onReadingEnd: () => {
                      setMegDialogue(null);
                      setActiveLoreNote(null);
                    },
                    onMegDoorRequest: () => setIsMegDoorOpen(true),
                    onSecretLevelFound: (targetLevel: number) => {
                      if (roomConfigRef.current.secretRoutes === false) return;
                       // Secret detours are local map changes, but their return
                       // is sent to the server so the convergence at Level 4
                       // remains synchronized.
                      const engine = engineRef.current;
                        const from = targetLevel === LEVEL_G || targetLevel === FUN_LEVEL ? ABANDONED_OFFICE_LEVEL : 1;
                      if (!engine || engine.level !== from) return;

                        if (targetLevel === LEVEL_G) {
                        console.log("Found the office door that shouldn't exist... entering LEVEL G.");
                        unlockAchievement("level_g_found");
                      } else if (targetLevel === FUN_LEVEL) {
                        console.log("Found the party at the office exit... entering LEVEL FUN.");
                      } else {
                         console.log("Found the dark corridor... entering Level 6: Lights Out.");
                        unlockAchievement("secret_level_found");
                      }

                      setLoadingMap(true);
                      setLoadingProgress(0);
                      setCurrentLevel(targetLevel);
                       engine.transitionToLevel(targetLevel, seed, settings);

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
                            engineRef.current.player.mapFullyLoaded = true;
                          }
                        }, 350);
                      }).catch((err) => {
                        console.error(`Error during secret level ${targetLevel} precreation:`, err);
                        setLoadingMap(false);
                        if (engineRef.current?.player) {
                          engineRef.current.player.mapFullyLoaded = true;
                        }
                      });
                    },
                    onLevelGProgress: (progress) => setLevelGProgress(progress),
                    onRedRoomExposureChange: (exp) => setRedRoomExposure(exp),
                    onToxicWaterExposureChange: (exp) => setToxicWaterExposure(exp),
                    onHUDNotification: (msg) => triggerNotification(msg),
                    onSectorChange: (sec) => setCurrentSector(sec),
                    onInventoryChange: (items) => setInventory(items),
                    onSanityChange: (san) => setSanity(san),
                    onPlayerRevive: () => {
                      setIsDead(false);
                      setAllDead(false);
                      setSpectateName(null);
                      playersRef.current.forEach((p) => { p.dead = false; });
                    },
                    onPlayerDeath: () => {
                      setIsDead(true);
                      setSpectateName(engineRef.current?.spectateName() ?? null);
                      socketRef.current?.send(JSON.stringify({ type: "died" }));
                    },
                    onDiaryPageCollected: () => {
                      const page: BackroomsLore = {
                        title: t("item.diary_page.name"),
                        author: t("note.diaryAuthor"),
                        date: "—",
                        location: `Level ${engineRef.current?.level ?? 0}`,
                        content: `${t("item.diary_page.lore")}\n\n${t("item.diary_page.clueText")}`,
                      };
                      setCollectedNotes((prev) => (prev.some((n) => n.title === page.title) ? prev : [...prev, page]));
                    },
                    onScrapOfNoteCollected: (noteSeed, doorMarker) => {
                      const lore = generateProceduralLore(noteSeed);
                      // Same clue on every note this seed, appended to the body
                      // (never the title, so the dedupe-by-title below still works).
                      if (doorMarker) {
                        lore.content += `\n\n${t("note.margin")}`;
                      }
                      setCollectedNotes((prev) => {
                        if (prev.some((n) => n.title === lore.title)) return prev;
                        return [...prev, lore];
                      });
                    },
                  }
                );

                // The room had already moved past Level 0 by the time we joined
                // (the rest of the group found an exit earlier) — catch up to that
                // same level instead of spawning alone back on Level 0.
                if (roomLevel > 0) {
                  engineRef.current.transitionToLevel(roomLevel, seed, settings);
                  setCurrentLevel(roomLevel);
                }
                if (roomLevel === POOLROOMS_LEVEL && poolroomsState) {
                  engineRef.current.applyPoolroomsState(poolroomsState);
                }

                // Set player lock state during generation to guarantee no movement
                if (engineRef.current && engineRef.current.player) {
                  engineRef.current.player.mapFullyLoaded = false;
                }

                // Replicated monsters/blackouts: who simulates which level.
                engineRef.current.localPlayerId = myId;
                // Cheats this room already unlocked at the lobby terminal.
                engineRef.current.applyRoomCheats(sanitizeRoomCheats(joinedCheats));
                engineRef.current.onSpectateChange = setSpectateName;
                engineRef.current.setWorldAuthority(worldAuthorityRef.current);

                // Instantly spawn existing players
                currentOn.forEach((p: RemotePlayer) => {
                  engineRef.current?.spawnRemotePlayer(p.id, p.name, p.x, p.y, p.z, p.suitColor, p.face, p.monsterSkin);
                  if (p.dead) engineRef.current?.setRemoteDead(p.id, true);
                  // Proximity VOIP: call them now if we already turned our mic on.
                  engineRef.current?.voipConnectPeer(p.id);
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
                setErrorMessage(t("err.engine"));
                setPhase(ConnectionPhase.ERROR);
              }
            }, 50);
          }

          // Server-authoritative "the room advanced to the next level" broadcast —
          // fires for every player in the room (including whoever triggered it),
          // so the group always transitions together onto the same level.
          else if (type === "level_transition" || type === "respawn" || type === "return_to_lobby") {
            const engine = engineRef.current;
            const nextLevel = data.level;
            const roomSeed = data.seed;
            // A respawn (whole room died, group chose a reset) may repeat or
            // go back to an earlier level; a plain transition only moves forward.
            const forced = type === "respawn" || type === "return_to_lobby";
            // An explorer waiting alone in the lobby (they aborted) rejoins the
            // group on its next transition, whatever the level number.
            if (!engine || typeof nextLevel !== "number" || (!forced && !data.secret && !data.convergence && !data.start && engine.level !== LOBBY_LEVEL && nextLevel <= engine.level)) return;

            if (forced) {
              logSystemMessage(
                data.solo ? t("sys.toLobbySelf")
                  : data.toLobby || data.completed ? t("sys.resetLobby")
                  : data.scratch ? t("sys.resetScratch")
                  : t("sys.resetLevel", { n: nextLevel })
              );
            } else {
              console.log(`Group noclipped into Level ${nextLevel}!`);
              if (nextLevel === 1) unlockAchievement("noclip_master");
            }

            // Poolrooms completion is the main-route ending. The server resets
            // the room to its lobby, but this client should see the existing
            // extraction screen instead of silently rebuilding the lobby.
            // The report goes over the game; the lobby loads underneath (below)
            // and the explorer stays in the room.
            if (type === "return_to_lobby" && data.completed === true) {
              // Already waiting in the lobby (they aborted earlier): nothing to rebuild.
              if (engine.level === LOBBY_LEVEL) return;
              unlockAchievement("absolute_survivor");
              document.exitPointerLock?.();
              setEscapedFrom(null);
              setEscapeReport("done");
            }

            // Everyone who died is back (server-side too).
            setIsDead(false);
            setAllDead(false);
            setWaitingForExit(false);
            setExitProgress(null);
            setSpectateName(null);
            if (forced && (data.scratch || data.toLobby || data.completed)) {
              setInventory([]);
              engine.inventory = [];
            }

            setLoadingMap(true);
            setLoadingProgress(0);
            setCurrentLevel(nextLevel);
            engine.transitionToLevel(nextLevel, roomSeed, settings);
            if (nextLevel === POOLROOMS_LEVEL && data.poolroomsState) {
              engine.applyPoolroomsState(data.poolroomsState);
            }

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
          }

          else if (type === "host") {
            setHostId(data.id);
          }

          else if (type === "room_cheats") {
            engineRef.current?.applyRoomCheats(sanitizeRoomCheats(data.cheats));
            if (typeof data.cheat === "string" && typeof data.by === "string") {
              logSystemMessage(t("sys.cheat", { name: data.by.toUpperCase(), code: CHEAT_CODES[data.cheat as RoomCheat | typeof SUDO_CHEAT] ?? data.cheat }));
            }
          }

          else if (type === "room_config") {
            if (data.config && typeof data.config === "object") setRoomConfig(data.config as RoomConfig);
          }

          else if (type === "exit_progress") {
            setExitProgress({ level: data.level, ready: data.ready, required: data.required });
            if (data.id === clientIdRef.current) {
              setWaitingForExit(true);
              engineRef.current?.setWaitingForTransition(true);
            }
          }

          else if (type === "ball") {
            engineRef.current?.applyBallState(data);
          }

          else if (type === "ball_kick") {
            engineRef.current?.applyBallKick(data);
          }

          else if (type === "player_died") {
            const { id: deadId } = data;
            const who = playersRef.current.find((p) => p.id === deadId);
            if (who) who.dead = true;
            engineRef.current?.setRemoteDead(deadId, true);
            if (deadId !== clientIdRef.current) {
              logSystemMessage(t("sys.died", { name: (who?.name ?? t("sys.someone")).toUpperCase() }));
            }
            touchRoster();
          }

          else if (type === "all_dead") {
            // Waiting alone in the lobby: the expedition's wipe isn't ours to see.
            if (engineRef.current?.level === LOBBY_LEVEL) return;
            setAllDead(true);
            document.exitPointerLock?.();
          }

          else if (type === "player_joined") {
            const { player } = data;
            if (!playersRef.current.some((p) => p.id === player.id)) {
              playersRef.current = [...playersRef.current, player];
              touchRoster();
            }

            // Update 3D engine world
            if (engineRef.current) {
              engineRef.current.spawnRemotePlayer(player.id, player.name, player.x, player.y, player.z, player.suitColor, player.face, player.monsterSkin);
              // Proximity VOIP: call them now if we already turned our mic on.
              engineRef.current.voipConnectPeer(player.id);
            }

            // Standard terminal join announcement message
            logSystemMessage(t("sys.joined", { name: player.name.toUpperCase() }));
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

              // The merged roster entry, not the raw snapshot: snapshots omit
              // the face, and the engine may need it to (re)spawn the model.
              engineRef.current?.updateRemotePlayer(player.id, existing ?? player);
            }

            if (added || incoming.length > 0) touchRoster();
          }

          else if (type === "player_to_lobby") {
            const who = playersRef.current.find((p) => p.id === data.id);
            if (who) logSystemMessage(t("sys.toLobby", { name: who.name.toUpperCase() }));
          }

          else if (type === "player_left") {
            const { id: leftId } = data;
            const departing = playersRef.current.find((p) => p.id === leftId);
            if (departing) {
              logSystemMessage(t("sys.left", { name: departing.name.toUpperCase() }));
            }
            playersRef.current = playersRef.current.filter((p) => p.id !== leftId);
            touchRoster();

            // Erase 3D nodes
            if (engineRef.current) {
              engineRef.current.removeRemotePlayer(leftId);
              engineRef.current.voipDisconnectPeer(leftId);
            }
          }

          else if (type === "voip_signal") {
            engineRef.current?.handleVoipSignal(data.from, data.data);
          }

          else if (type === "authority") {
            worldAuthorityRef.current = data.byLevel || {};
            engineRef.current?.setWorldAuthority(worldAuthorityRef.current);
          }

          else if (type === "entities") {
            engineRef.current?.applyWorldState(data);
          }

          else if (type === "world_event") {
            engineRef.current?.applyWorldEvent(data);
          }

          else if (type === "entities_relocate") {
            engineRef.current?.handleRelocateRequest(data);
          }

          else if (type === "box_push") {
            engineRef.current?.applyBoxPush(data);
          }

          else if (type === "levelg_code") {
            engineRef.current?.handleLevelGCodeRequest(data);
          }

          else if (type === "poolrooms_state") {
            engineRef.current?.applyPoolroomsState(data);
          }

          else if (type === "brick_office_switch") {
            engineRef.current?.handleLevel3Switch(data.index);
          }

          else if (type === "fun_event") {
            engineRef.current?.applyFunEvent(data);
          }

          else if (type === "chat_message") {
            const { sender, text } = data;
            const timeStr = new Date().toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" });
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
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        setLatency(undefined);
        // If we were active in game, transition back gracefully reporting connection issues
        if (phase === ConnectionPhase.PLAYING) {
          disconnect(true, t("err.linkLost"));
        }
      };

      socket.onerror = (e) => {
        console.error("Networking Socket Error reported:", e);
        setErrorMessage(t("err.request"));
        setPhase(ConnectionPhase.ERROR);
      };

    } catch (e) {
      console.error(e);
      setErrorMessage(t("err.noContact"));
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
    const timeStr = new Date().toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" });
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
   * "Abort infiltration": back to this room's lobby, alone — never out of the
   * room. The group carries on and pulls this explorer back in at its next
   * level transition. Falls back to leaving only if the link is already gone.
   */
  const abortToLobby = () => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "return_to_lobby_request" }));
    else disconnect(false);
  };

  /** Closes the extraction report; the explorer is already in the room's lobby. */
  const closeEscapeReport = () => {
    setEscapeReport(null);
    setLevelGEnding("none");
  };

  /**
   * Safe disconnect/wipe callback returning to main menu. The only way out of
   * a room: the explicit "leave room" button (or a lost link).
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
    setVoipEnabled(false);
    setVoipSpeaking(false);
    setEscapeReport(null);

    if (hasError) {
      setErrorMessage(errorMsg || t("err.disconnected"));
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
          onCreate={() => connectToLobby({ create: true })}
          onJoin={(code) => connectToLobby({ code })}
          initialCode={inviteCode}
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
              <h2 className="text-xl font-bold tracking-widest uppercase">{t("connect.title")}</h2>
              <p className="text-xs text-[#a28e3b] uppercase leading-relaxed">
                {t("connect.text")}
              </p>
            </div>
            <div className="text-[10px] bg-[#0b0a05] text-[#a28e3b]/70 border border-[#a28e3b]/10 py-2.5 rounded">
              {roomCode ? `${t("hud.lobby").toUpperCase()} ${roomCode}` : ""}
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

          {/* Hydrolitis Plague toxic water vignette (Level 7) */}
          {currentLevel === 7 && toxicWaterExposure > 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-30 transition-all duration-300 ease-out"
              style={{
                background: `radial-gradient(circle, rgba(0,0,0,0) 30%, rgba(74,140,26,${Math.min(0.9, 0.2 + (toxicWaterExposure / 8) * 0.7)}) 100%)`
              }}
            />
          )}

          {/* Locked Mouse Notice/Overlay */}
          {/* Locked Mouse Notice/Overlay (Custom Pause Menu with Diário) */}
          {!pointerLocked && !pointerLockedOverride && !isInventoryOpen && !allDead && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#000000]/92 text-[#deb81d] z-50 text-center px-4 font-mono select-none">
              <div className="w-full max-w-3xl border border-[#a28e3b]/50 bg-[#14130a] rounded shadow-[0_0_50px_rgba(222,184,29,0.15)] flex flex-col h-[520px] max-h-[90vh] overflow-hidden pointer-events-auto">
                
                {/* Header with Navigation Tabs */}
                <div className="flex items-center justify-between border-b border-[#a28e3b]/30 bg-[#0c0b05]/95 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 bg-red-600 rounded-full animate-ping" />
                    <span className="font-extrabold text-sm tracking-widest uppercase">{t("pause.title")}</span>
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
                      {t("pause.tabControls")}
                    </button>
                    <button
                      onClick={() => setPauseMenuTab("config")}
                      className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                        pauseMenuTab === "config"
                          ? "bg-[#deb81d] text-black border-[#deb81d]"
                          : "bg-black/40 text-[#a28e3b] border-transparent hover:border-[#a28e3b]/30"
                      }`}
                    >
                      {t("pause.tabSettings")}
                    </button>
                    <button
                      onClick={() => setPauseMenuTab("diario")}
                      className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer transition-all flex items-center gap-2 ${
                        pauseMenuTab === "diario"
                          ? "bg-[#deb81d] text-black border-[#deb81d]"
                          : "bg-black/40 text-[#a28e3b] border-transparent hover:border-[#a28e3b]/30"
                      }`}
                    >
                      {t("pause.tabJournal")}
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
                          <h3 className="text-lg font-black uppercase tracking-wider">{t("pause.unfocused")}</h3>
                        </div>
                        <p className="text-xs text-[#a28e3b] uppercase leading-relaxed max-w-sm">
                          {t("pause.unfocusedText")}
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
                            {t("pause.noLock")}
                          </button>
                          <p className="text-[10px] text-[#a28e3b]/60 uppercase tracking-wider">
                            {t("pause.noLockHint")}
                          </p>
                        </div>
                      </div>

                      <div className="w-full md:w-[320px] text-xs text-left text-[#a28e3b]/85 bg-[#0b0a05] border border-[#a28e3b]/20 p-5 rounded space-y-2.5 shadow-inner">
                        <div className="font-extrabold border-b border-[#a28e3b]/25 pb-1.5 mb-2 text-[#deb81d] uppercase tracking-wider">
                          {t("pause.guide")}
                        </div>
                        <div className="flex justify-between"><span>{t("controls.moveExplorer")}</span><span className="text-[#deb81d] font-bold">W, A, S, D / Setas</span></div>
                        <div className="flex justify-between"><span>{t("controls.look")}</span><span className="text-[#deb81d] font-bold">{t("controls.lookKey")}</span></div>
                        <div className="flex justify-between"><span>{t("controls.run")}</span><span className="text-[#deb81d] font-bold">L-SHIFT</span></div>
                        <div className="flex justify-between"><span>{t("controls.crouch")}</span><span className="text-[#deb81d] font-bold">CTRL / C</span></div>
                        <div className="flex justify-between"><span>{t("controls.flashlight")}</span><span className="text-[#deb81d] font-bold">F</span></div>
                        <div className="flex justify-between"><span>{t("controls.inventory")}</span><span className="text-[#deb81d] font-bold">I</span></div>
                        <div className="flex justify-between"><span>{t("controls.achievements")}</span><span className="text-[#deb81d] font-bold">K</span></div>
                        <div className="flex justify-between"><span>{t("controls.chat")}</span><span className="text-[#deb81d] font-bold">T</span></div>
                        <div className="flex justify-between"><span>{t("controls.release")}</span><span className="text-[#deb81d] font-bold">ESC</span></div>
                      </div>
                    </div>
                  ) : pauseMenuTab === "config" ? (
                    <PauseSettings settings={settings} onUpdateSettings={handleUpdateSettings} />
                  ) : (
                    /* Diário / Journal Tab Content */
                    <div className="flex-1 flex overflow-hidden">
                      {/* Sidebar list of notes */}
                      <div className="w-[240px] border-r border-[#a28e3b]/20 bg-black/40 flex flex-col">
                        <div className="p-3 border-b border-[#a28e3b]/10 text-[10px] text-[#a28e3b] uppercase font-bold tracking-widest text-center bg-[#14130a]/50">
                          {t("pause.logs", { n: collectedNotes.length })}
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-[#a28e3b]/10 scrollbar-thin scrollbar-thumb-amber-500/20">
                          {collectedNotes.length === 0 ? (
                            <div className="p-4 text-center text-[10px] text-[#a28e3b]/50 italic uppercase leading-relaxed pt-12">
                              {t("pause.noNotes")}
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
                                  <h4 className="text-xs font-bold text-[#deb81d] uppercase tracking-widest">{t("pause.emptyJournal")}</h4>
                                  <p className="text-[10px] text-[#a28e3b]/70 uppercase max-w-xs leading-relaxed">
                                    {t("pause.emptyJournalText")}
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
                                  <span>{t("pause.author")} <span className="text-stone-200">{activeNote.author}</span></span>
                                  <span>{t("pause.record")} <span className="text-stone-200">{activeNote.date}</span></span>
                                </div>
                                <div className="text-[10px] text-[#a28e3b] font-bold truncate uppercase flex items-center gap-1">
                                  <Compass className="w-3 h-3 text-[#deb81d]" />
                                  <span>{t("pause.place")} <span className="text-[#deb81d]">{activeNote.location}</span></span>
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

                <AdSlot placement="pause" className="mx-auto border-t border-[#a28e3b]/15 bg-black/20 px-3 py-1" />

                {/* Footer close info */}
                <div className="border-t border-[#a28e3b]/20 bg-[#0c0b05]/95 px-6 py-3.5 flex justify-between items-center">
                  <span className="text-[9px] text-[#a28e3b] uppercase">{t("pause.footer")}</span>
                  <div className="flex items-center">
                  {roomCode && (
                    <button
                      id="btn-pause-copy"
                      onClick={copyInviteLink}
                      className="mr-3 border border-[#a28e3b]/40 text-[#a28e3b] hover:text-[#deb81d] hover:border-[#deb81d]/50 font-bold uppercase tracking-wider px-3 py-2 rounded cursor-pointer transition-all text-xs"
                    >
                      {linkCopied ? t("lobby.copied") : `${t("pause.roomCode", { code: roomCode })} · ${t("pause.copyLink")}`}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      // Lock mouse back or trigger override if pointer lock is unavailable
                      const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement;
                      if (canvasEl) {
                        lockGameInput(canvasEl);
                      } else {
                        setPointerLockedOverride(true);
                      }
                    }}
                    className="bg-[#deb81d] hover:bg-[#ebd255] text-black font-black uppercase tracking-wider px-5 py-2 rounded cursor-pointer transition-all text-xs"
                  >
                    {t("pause.resume")}
                  </button>
                  {currentLevel !== LOBBY_LEVEL && (
                    <button
                      id="btn-pause-abort"
                      onClick={abortToLobby}
                      className="ml-3 bg-[#1c0808]/75 hover:bg-red-950/90 text-red-400 hover:text-red-300 border border-red-950 font-bold uppercase tracking-wider px-4 py-2 rounded cursor-pointer transition-all text-xs"
                    >
                      {t("pause.abort")}
                    </button>
                  )}
                  <button
                    id="btn-pause-leave-room"
                    onClick={() => disconnect(false)}
                    className="ml-3 bg-transparent hover:bg-red-950/60 text-stone-400 hover:text-red-300 border border-stone-700 hover:border-red-900 font-bold uppercase tracking-wider px-4 py-2 rounded cursor-pointer transition-all text-xs"
                  >
                    {t("pause.leaveRoom")}
                  </button>
                  </div>
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
                    {t("loading.init")}
                  </div>
                   <h2 className="text-lg font-black tracking-widest text-[#deb81d] uppercase select-none flex items-center justify-between">
                    <span>{t("loading.decompress", { name: displayLabelForLevel(currentLevel) })}</span>
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
                  <div className={loadingProgress >= 5 ? "opacity-100" : "opacity-0"}>{t("loading.connect")}</div>
                  <div className={loadingProgress >= 28 ? "opacity-100 animate-pulse" : "opacity-0"}>[OK] Sincronizando com a semente {currentSeed}...</div>
                  <div className={loadingProgress >= 50 ? "opacity-100 font-bold" : "opacity-0"}>
                    {currentLevel === 3
                      ? t("loading.l3a")
                      : currentLevel === 1
                        ? t("loading.l1a")
                        : t("loading.l0a")
                    }
                  </div>
                  <div className={loadingProgress >= 72 ? "opacity-100" : "opacity-0"}>
                    {currentLevel === 3
                      ? t("loading.l3b")
                      : currentLevel === 1
                        ? t("loading.l1b")
                        : t("loading.l0b")
                    }
                  </div>
                  <div className={loadingProgress >= 92 ? "opacity-100" : "opacity-0"}>
                    {currentLevel === 3
                      ? t("loading.l3c")
                      : currentLevel === 1
                        ? t("loading.l1c")
                        : t("loading.l0c")
                    }
                  </div>
                </div>

                <div className="text-[9px] text-[#a28e3b]/50 uppercase tracking-widest leading-relaxed">
                  {t("loading.dontSwitch")}
                </div>
              </div>
            </div>
          )}

          {/* Death: spectating a living teammate */}
          {waitingForExit && exitProgress && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 font-mono select-none pointer-events-none">
              <div className="bg-black/75 border border-cyan-800 rounded px-5 py-3 text-center text-cyan-300 uppercase tracking-widest text-[10px]">
                {t("exit.waiting")}<br />
                <span className="text-stone-300">{exitProgress.ready}/{exitProgress.required}</span>
              </div>
            </div>
          )}

          {/* Death: spectating a living teammate */}
          {isDead && !allDead && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 font-mono select-none pointer-events-none">
              <div className="flex items-center gap-2 text-red-500 font-black tracking-[0.3em] text-sm uppercase animate-pulse">
                <Skull className="w-4 h-4" /> {t("dead.title")}
              </div>
              <div className="flex items-center gap-3 bg-black/70 border border-red-950 rounded px-4 py-2 pointer-events-auto">
                <button
                  onClick={() => engineRef.current?.cycleSpectate(-1)}
                  className="text-[#deb81d] hover:text-white px-2 cursor-pointer"
                  aria-label={t("dead.prev")}
                >◀</button>
                <span className="text-[11px] text-stone-300 uppercase tracking-widest min-w-[10rem] text-center">
                  {spectateName ? <>{t("dead.spectating")} <b className="text-[#deb81d]">{spectateName}</b></> : t("dead.nobody")}
                </span>
                <button
                  onClick={() => engineRef.current?.cycleSpectate(1)}
                  className="text-[#deb81d] hover:text-white px-2 cursor-pointer"
                  aria-label={t("dead.next")}
                >▶</button>
              </div>
              <div className="text-[9px] text-stone-400 uppercase tracking-widest">
                {t("dead.hint")}
              </div>
            </div>
          )}

          {/* Everyone died: the configured room policy is applied by the server. */}
          {allDead && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 px-4 font-mono select-none">
              <div className="max-w-md w-full border border-red-950 bg-[#090303] p-8 rounded text-center space-y-5 shadow-[0_0_40px_rgba(220,38,38,0.2)]">
                <Skull className="w-10 h-10 text-red-600 mx-auto" />
                <h2 className="text-2xl font-black tracking-[0.2em] text-red-600 uppercase">{t("alldead.title")}</h2>
                <p className="text-xs text-stone-400 uppercase leading-relaxed font-sans">
                  {t("alldead.text")}
                </p>
                <div className="border border-red-900/70 bg-red-950/20 px-4 py-3 text-xs text-red-300 uppercase tracking-wider">
                  {t("roomConfig.autoReset")} {roomConfig.deathAction === "current_level" ? t("roomConfig.currentLevel") : roomConfig.deathAction === "level_0" ? t("roomConfig.levelZero") : t("roomConfig.lobby")}
                </div>
              </div>
            </div>
          )}

          {/* Room lobby: invite code, who's here, and the host's start button */}
          {currentLevel === LOBBY_LEVEL && !loadingMap && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,26rem)] font-mono select-none">
              <div className="border border-[#a28e3b]/40 bg-[#0c0b05]/85 backdrop-blur-sm rounded p-4 space-y-3 text-center pointer-events-auto">
                <div className="text-[10px] tracking-[0.3em] text-[#a28e3b] uppercase">{t("lobby.title")}</div>
                <div>
                  <div className="text-[9px] text-[#a28e3b]/70 uppercase tracking-widest">{t("lobby.code")}</div>
                  <div id="lobby-room-code" className="text-3xl font-black tracking-[0.35em] text-[#deb81d]">{roomCode}</div>
                </div>
                <button
                  id="btn-lobby-copy"
                  onClick={copyInviteLink}
                  className="text-[10px] uppercase tracking-wider border border-[#deb81d]/40 text-[#deb81d] hover:bg-[#deb81d]/10 px-3 py-1.5 rounded cursor-pointer transition-all"
                >
                  {linkCopied ? t("lobby.copied") : t("lobby.copyLink")}
                </button>
                <div className="text-[10px] text-stone-400">{t("lobby.invite")}</div>
                <div className="text-[10px] text-stone-300 uppercase tracking-wider">
                  {t("lobby.players", { n: connectedPlayers.length + 1 })}
                </div>
                <div className="border-t border-[#a28e3b]/20 pt-3 text-left space-y-2">
                  <div className="text-[9px] tracking-[0.2em] text-[#a28e3b] uppercase">{t("roomConfig.title")}</div>
                  <div className="text-[9px] text-stone-400 uppercase">{t("roomConfig.deathAction")}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(["current_level", "level_0", "lobby"] as DeathAction[]).map((action) => (
                      <button
                        key={action}
                        disabled={!isHost}
                        onClick={() => socketRef.current?.send(JSON.stringify({ type: "room_config_update", config: { deathAction: action } }))}
                        className={`border px-2 py-2 text-[9px] uppercase transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${roomConfig.deathAction === action ? "border-[#deb81d] bg-[#deb81d]/15 text-[#deb81d]" : "border-[#a28e3b]/30 text-stone-400 hover:border-[#deb81d]/60"}`}
                      >
                        {action === "current_level" ? t("roomConfig.currentLevel") : action === "level_0" ? t("roomConfig.levelZero") : t("roomConfig.lobby")}
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={!isHost}
                    onClick={() => socketRef.current?.send(JSON.stringify({ type: "room_config_update", config: { secretRoutes: !roomConfig.secretRoutes } }))}
                    className={`w-full border px-2 py-2 text-[9px] uppercase text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${roomConfig.secretRoutes ? "border-cyan-800 text-cyan-300" : "border-red-900 text-red-400"}`}
                  >
                    {t("roomConfig.secretRoutes")}: {roomConfig.secretRoutes ? t("roomConfig.enabled") : t("roomConfig.disabled")}
                  </button>
                  {!isHost && <div className="text-[9px] text-amber-400/80 uppercase">{t("roomConfig.hostOnly")}</div>}
                </div>
                {expeditionRunning ? (
                  <div id="lobby-expedition-running" className="text-[10px] text-cyan-300/90 uppercase tracking-wider leading-relaxed">{t("lobby.expeditionRunning")}</div>
                ) : isHost ? (
                  <button
                    id="btn-lobby-start"
                    onClick={() => socketRef.current?.send(JSON.stringify({ type: "start_game" }))}
                    className="w-full bg-[#deb81d] hover:bg-[#ebd255] text-black font-black uppercase tracking-wider px-4 py-2 rounded cursor-pointer transition-all text-xs"
                  >
                    {t("lobby.startKey")}
                  </button>
                ) : (
                  <div className="text-[10px] text-[#a28e3b] uppercase tracking-wider animate-pulse">{t("lobby.waitHost")}</div>
                )}
                <div className="text-[9px] text-stone-500 leading-relaxed">{t("lobby.tips")}</div>
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
            roomKey={roomCode}
            connectedPlayers={connectedPlayers}
            playersRef={playersRef}
            perf={perf}
            showFps={settings.showFps}
            latency={latency}
            chatMessages={chatMessages}
            onSendMessage={handleSendMessage}
            level={currentLevel}
            engineRef={engineRef}
            currentSector={currentSector}
            hudNotification={hudNotification}
            notificationKey={notificationKey}
            onOpenInventory={() => setIsInventoryOpen(true)}
            inventoryCount={inventory.length}
            onOpenAchievements={() => setIsAchievementsOpen(true)}
            levelGProgress={levelGProgress}
            objective={funObjective}
            voipEnabled={voipEnabled}
            voipSpeaking={voipSpeaking}
            onToggleVoip={() => {
              const engine = engineRef.current;
              if (!engine) return;
              if (engine.voipEnabled) engine.disableVoip();
              else engine.enableVoip();
            }}
          />

          {isTerminalOpen && currentLevel === LEVEL_G && (
            <TerminalModal
              digits={levelGProgress.digits}
              onSubmit={(code) => engineRef.current?.submitLevelGCode(code) ?? false}
              onClose={() => {
                setIsTerminalOpen(false);
                const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement | null;
                if (canvasEl) lockGameInput(canvasEl);
              }}
            />
          )}
          {isFunPanelOpen && currentLevel === FUN_LEVEL && (
            <FunPanelModal
              initialProgress={engineRef.current?.funPanelProgress() ?? 0}
              onPress={(index) => engineRef.current?.funPressButton(index) ?? { result: "wrong", progress: 0 }}
              onClose={() => {
                setIsFunPanelOpen(false);
                const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement | null;
                if (canvasEl) lockGameInput(canvasEl);
              }}
            />
          )}
          {isMegDoorOpen && currentLevel === 4 && (
            <MegDoorModal
              onSubmit={(ids) => engineRef.current?.submitMegDoorIds(ids) ?? false}
              onClose={() => {
                setIsMegDoorOpen(false);
                const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement | null;
                if (canvasEl) lockGameInput(canvasEl);
              }}
            />
          )}
          {/* MEG employee dialogue: a subtitle box, read without leaving the game */}
          {megDialogue && currentLevel === 4 && !isMegDoorOpen && (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
              <div className="w-full max-w-2xl border border-amber-500/60 bg-[#171513]/90 px-6 py-4 text-slate-100 shadow-[0_0_30px_rgba(0,0,0,0.6)]">
                <div className="mb-1 text-[10px] tracking-[0.25em] text-amber-400">{t("dialog.megEmployee", { grade: megDialogue.grade.toUpperCase() })}</div>
                <h2 className="mb-2 text-xl font-bold">{megDialogue.name}</h2>
                <p className="text-sm text-slate-300">{megDialogue.dialogue}</p>
                <div className="mt-3 text-right text-[10px] uppercase tracking-widest text-amber-500/80">{t("dialog.closeHint")}</div>
              </div>
            </div>
          )}

          {isCheatTerminalOpen && currentLevel === LOBBY_LEVEL && (
            <CheatTerminalModal
                     onSubmit={(code) => {
                       const result = engineRef.current?.submitCheatCode(code) ?? null;
                       // Room cheats are unlocked by the server for everyone in the
                       // room; the effect lands when its "room_cheats" broadcast returns.
                       if (result && (result === SUDO_CHEAT || (ROOM_CHEATS as readonly string[]).includes(result))) {
                         socketRef.current?.send(JSON.stringify({ type: "cheat_unlock", cheat: result }));
                       }
                       return result;
                     }}
                     onUnlockRoom={() => setIsLevelSelectorOpen(true)}
              currentSkin={cheatSkin}
              onPickSkin={(skin) => {
                engineRef.current?.applySkinCheat(skin);
                setCheatSkin(skin);
              }}
              onClose={() => {
                setIsCheatTerminalOpen(false);
                const canvasEl = document.querySelector("#threejs-viewport canvas") as HTMLCanvasElement | null;
                if (canvasEl) lockGameInput(canvasEl);
              }}
            />
          )}

          {isLevelSelectorOpen && currentLevel === LOBBY_LEVEL && (
            <LevelSelectorModal
              isHost={clientIdRef.current === hostIdRef.current}
              onStart={(level) => {
                socketRef.current?.send(JSON.stringify({ type: "start_game", level }));
                setIsLevelSelectorOpen(false);
              }}
              onClose={() => setIsLevelSelectorOpen(false)}
            />
          )}

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
          {/* Context hint (e.g. "[E] Empurrar caixa") just below the crosshair */}
          {interactPrompt && !megDialogue && !activeLoreNote && !isInventoryOpen && !isAchievementsOpen && !isTerminalOpen && !isCheatTerminalOpen && (
            <div className="fixed left-1/2 top-[58%] -translate-x-1/2 z-40 pointer-events-none font-mono">
              <div className="bg-[#0b0b05]/80 border border-[#deb81d]/60 rounded px-3 py-1.5 text-[11px] tracking-widest uppercase text-[#deb81d] shadow-[0_0_12px_rgba(222,184,29,0.25)]">
                {interactPrompt}
              </div>
            </div>
          )}

          {/* CLIP cheat: flashes while actively phasing through walls */}
          {isNoclipActive && (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none font-mono">
              <div className="bg-[#ffb703]/15 border border-[#ffb703] rounded px-3 py-1 text-[10px] font-black tracking-widest uppercase text-[#ffb703] animate-pulse shadow-[0_0_12px_rgba(255,183,3,0.35)]">
                {t("hud.noclip")}
              </div>
            </div>
          )}

          {achievementToast && (
            <div className="fixed top-6 right-6 z-50 pointer-events-none font-mono animate-bounce">
              <div className="bg-[#0b0b05]/95 border-2 border-[#deb81d] rounded px-5 py-4 flex items-center gap-4 shadow-[0_0_25px_rgba(222,184,29,0.35)] max-w-sm">
                <div className="p-2 bg-[#deb81d]/15 border border-[#deb81d] rounded animate-pulse">
                  <Trophy className="w-5 h-5 text-[#deb81d]" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#a28e3b] font-bold">{t("ach.toast")}</div>
                  <div className="text-xs font-black uppercase text-[#ebd255] tracking-wider mt-0.5">{(achievementToast as any).title}</div>
                  <div className="text-[9px] text-stone-300 font-sans mt-1 leading-tight">{(achievementToast as any).description}</div>
                </div>
              </div>
            </div>
          )}

          {/* Exit-desk paper: read in-game (pointer lock kept, the world keeps running) */}
          {activeLoreNote && (
            <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4 select-none font-mono">
              <div
                id="lore-note-modal"
                className="relative w-full max-w-xl bg-[#1e1c14]/92 border-2 border-[#deb81d]/50 rounded p-6 sm:p-8 shadow-[0_0_50px_rgba(222,184,29,0.15)] flex flex-col gap-6"
              >
                {/* Paper texture aesthetics */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(222,184,29,0.03)_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none rounded" />

                {/* Header */}
                <div className="flex items-center gap-3 border-b border-[#a28e3b]/30 pb-4 z-10">
                  <div className="p-2 bg-amber-400/10 border border-[#deb81d]/30 rounded">
                    <FileText className="w-5 h-5 text-[#deb81d]" />
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-[#a28e3b]">{t("note.found")}</div>
                    <h3 className="text-sm font-black text-[#deb81d] uppercase tracking-wider">{activeLoreNote.title}</h3>
                  </div>
                </div>

                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 bg-black/30 border border-[#a28e3b]/10 p-3 rounded text-[10px] z-10 text-stone-300">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#a28e3b] font-bold">{t("note.author")}</span>
                    <span className="truncate">{activeLoreNote.author}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#a28e3b] font-bold">{t("note.date")}</span>
                    <span>{activeLoreNote.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5 col-span-2">
                    <Compass className="w-3.5 h-3.5 text-[#a28e3b]" />
                    <span className="text-[#a28e3b] font-bold">{t("note.location")}</span>
                    <span className="text-[#deb81d]">{activeLoreNote.location}</span>
                  </div>
                </div>

                {/* Main Content — scrolled by the mouse wheel (see loreNoteScrollRef) */}
                <div ref={loreNoteScrollRef} className="flex-1 overflow-y-auto max-h-[300px] pr-2 scrollbar-thin scrollbar-thumb-amber-500/20 z-10">
                  <p className="text-xs sm:text-sm text-amber-100/90 leading-relaxed font-serif italic whitespace-pre-wrap">
                    {activeLoreNote.content}
                  </p>
                </div>

                {/* Footer instructions */}
                <div className="border-t border-[#a28e3b]/20 pt-4 flex justify-between items-center z-10 text-[9px] text-[#a28e3b]">
                  <span className="animate-pulse">{t("note.insight")}</span>
                  <span className="uppercase tracking-widest text-[#deb81d]">{t("note.closeHint")}</span>
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
              <h2 className="text-lg font-bold tracking-widest text-[#deb81d] uppercase">{t("err.title")}</h2>
              <p className="text-xs text-red-400 uppercase leading-relaxed">
                {errorMessage || t("err.default")}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                id="btn-error-menu"
                onClick={() => setPhase(ConnectionPhase.MENU)}
                className="flex-1 bg-transparent border border-red-500/40 hover:bg-red-500/10 text-red-400 py-3 rounded text-xs uppercase tracking-wider font-semibold transition-colors cursor-pointer"
              >
                {t("err.menu")}
              </button>
              <button
                id="btn-error-retry"
                onClick={() => connectToLobby(lastJoinRef.current)}
                className="flex-1 flex items-center justify-center gap-2 bg-[#deb81d] hover:bg-[#ebd255] text-black py-3 rounded text-xs uppercase tracking-wider font-bold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                {t("err.retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 5: SUCCESSFUL ESCAPE / VICTORY SCREEN */}
      {(phase === ConnectionPhase.ESCAPED || escapeReport !== null) && (
        <div className={`${escapeReport !== null ? "fixed inset-0 z-[300]" : "w-full h-screen relative"} flex flex-col items-center justify-center bg-[#050604] text-[#deb81d] px-6 select-none animate-fade-in font-mono`}>
          {/* Subtle emergency scanline overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(10,35,10,0.15)_0%,rgba(0,0,0,0.95)_100%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,6px_100%] pointer-events-none opacity-45" />

          {levelGEnding === "message" ? (
            <div className="max-w-xl w-full text-center relative space-y-7 animate-fade-in px-4">
              <h2 className="text-4xl md:text-5xl font-black tracking-[0.3em] text-[#e9ffe9] uppercase drop-shadow-[0_0_18px_rgba(60,255,122,0.45)]">
                {t("esc.gTitle")}
              </h2>
              <div className="space-y-3 text-sm md:text-base text-stone-300 font-sans leading-relaxed">
                <p>{t("esc.g1")}</p>
                <p>{t("esc.g2")}</p>
              </div>
              <p className="text-2xl font-black tracking-widest text-[#3cff7a] uppercase">{t("esc.g3")}</p>
              <p className="text-xs text-stone-500 italic font-sans">{t("esc.g4")}</p>
              <button
                id="btn-level-g-continue"
                onClick={() => setLevelGEnding("done")}
                className="mt-4 px-8 bg-[#1f7a3a] hover:bg-[#2a9b4b] text-black font-extrabold uppercase tracking-widest py-3 rounded text-xs transition-colors cursor-pointer"
              >
                {t("esc.continue")}
              </button>
            </div>
          ) : (escapeReport ?? (currentLevel === 1 ? "l2" : "done")) === "l2" ? (
            <div className="max-w-xl w-full border border-orange-600/30 bg-[#140b05]/92 p-8 rounded text-center relative space-y-6 shadow-[0_0_25px_rgba(234,88,12,0.15)] animate-fade-in">
              <div className="w-16 h-16 bg-orange-950/60 border border-orange-500/50 rounded-full flex items-center justify-center mx-auto relative animate-pulse">
                <span className="w-12 h-12 bg-orange-500 rounded-full animate-ping absolute opacity-20" />
                <HelpCircle className="w-8 h-8 text-orange-500 rotate-180" />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-2xl font-black tracking-widest text-orange-400 uppercase">{t("esc.l2Title")}</h2>
                
                <div className="p-4 bg-black/60 border border-orange-950/60 rounded text-left space-y-3 text-xs leading-relaxed font-sans text-gray-300">
                  <div className="font-bold text-orange-400 border-b border-orange-950/60 pb-1 font-mono uppercase tracking-widest">
                    {t("esc.l2DescTitle")}
                  </div>
                  <p>
                    {t("esc.l2Desc")}
                  </p>
                </div>
                
                <div className="p-4 bg-black/60 border border-orange-950/60 rounded text-left space-y-1.5 text-xs text-[#a28e3b]/80 font-mono">
                  <div className="font-bold text-orange-400 border-b border-orange-950/60 pb-1 mb-1 uppercase">
                    {t("esc.reportInfil")}
                  </div>
                  <div>• {t("esc.statusAlive")} <span className="text-orange-400 font-bold">{t("esc.aliveDuress")}</span></div>
                  <div>• {t("esc.destination")} <span className="text-white">{t("esc.destL2")}</span></div>
                  <div>• {t("esc.contactSignal")} <span className="text-[#deb81d]">{settings.name}</span></div>
                  <div>• {t("esc.seed")} <span className="text-gray-400">{currentSeed}</span></div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="btn-escaped-return-l2"
                  onClick={escapeReport !== null ? closeEscapeReport : () => setPhase(ConnectionPhase.MENU)}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-black font-extrabold uppercase tracking-widest py-3 rounded text-xs transition-colors cursor-pointer shadow-lg hover:shadow-orange-600/10"
                >
                  {escapeReport !== null ? t("esc.backLobby") : t("esc.backMenu")}
                </button>
                {escapeReport !== null && (
                  <button
                    id="btn-escaped-leave-room"
                    onClick={() => disconnect(false)}
                    className="w-full mt-3 bg-transparent border border-stone-700 hover:border-red-900 text-stone-400 hover:text-red-300 font-bold uppercase tracking-widest py-2.5 rounded text-xs transition-colors cursor-pointer"
                  >
                    {t("pause.leaveRoom")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-xl w-full border border-green-600/30 bg-[#0a180a]/92 p-8 rounded text-center relative space-y-6 shadow-[0_0_25px_rgba(34,197,94,0.15)]">
              <div className="w-16 h-16 bg-green-950/60 border border-green-500/50 rounded-full flex items-center justify-center mx-auto relative animate-pulse">
                <span className="w-12 h-12 bg-green-500 rounded-full animate-ping absolute opacity-20" />
                <HelpCircle className="w-8 h-8 text-green-500 rotate-180" />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-2xl font-black tracking-widest text-green-400 uppercase">{t("esc.doneTitle")}</h2>
                <p className="text-sm text-green-300 uppercase leading-relaxed font-sans">
                  {escapedFrom === FUN_LEVEL ? t("esc.funText") : t("esc.doneText2")}
                </p>
                
                <div className="p-4 bg-black/60 border border-green-950/60 rounded text-left space-y-1.5 text-xs text-[#a28e3b]/80">
                  <div className="font-bold text-green-400 border-b border-green-950/60 pb-1 mb-1">
                    {t("esc.reportExtract")}
                  </div>
                  <div>• {t("esc.statusAlive")} <span className="text-green-400 font-bold">{t("esc.aliveSafe")}</span></div>
                  <div>• {t("esc.sector")} <span className="text-white">{levelGEnding === "done" ? t("esc.sectorG") : "COUT-SPACE L0-45"}</span></div>
                  <div>• {t("esc.contactSignal")} <span className="text-[#deb81d]">{settings.name}</span></div>
                  <div>• {t("esc.seed")} <span className="text-gray-400">{currentSeed}</span></div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="btn-escaped-return"
                  onClick={escapeReport !== null ? closeEscapeReport : () => setPhase(ConnectionPhase.MENU)}
                  className="w-full bg-green-600 hover:bg-green-500 text-black font-extrabold uppercase tracking-widest py-3 rounded text-xs transition-colors cursor-pointer shadow-lg hover:shadow-green-600/10"
                >
                  {escapeReport !== null ? t("esc.backLobby") : t("esc.backMenu")}
                </button>
                {escapeReport !== null && (
                  <button
                    id="btn-escaped-leave-room"
                    onClick={() => disconnect(false)}
                    className="w-full mt-3 bg-transparent border border-stone-700 hover:border-red-900 text-stone-400 hover:text-red-300 font-bold uppercase tracking-widest py-2.5 rounded text-xs transition-colors cursor-pointer"
                  >
                    {t("pause.leaveRoom")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

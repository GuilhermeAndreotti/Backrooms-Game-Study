/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proximity voice chat: a WebRTC mesh (every pair of teammates gets a direct
 * peer connection) with volume attenuated by in-game distance, so you only
 * hear teammates who are near you and on the same level — like standing close
 * enough to talk in real life. The relay server (see server.ts's
 * "voip_signal" handler) only ever forwards opaque SDP/ICE blobs between two
 * specific players; it never sees or touches the audio itself, which flows
 * peer-to-peer once the handshake completes.
 *
 * Room sizes here are small (4 players, so at most 3 connections per peer),
 * so a full mesh needs no SFU. NAT traversal uses a public STUN server only
 * (no TURN) — most home connections punch through fine, but a strict
 * symmetric NAT on either end can fail to connect; there's no relay fallback.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** Beyond this distance (metres) a teammate is inaudible even on the same level. */
const AUDIBLE_RANGE = 22;

interface Peer {
  id: string;
  conn: RTCPeerConnection;
  audio: HTMLAudioElement | null;
  /** Buffers ICE candidates that arrive before the remote description is set. */
  pendingCandidates: RTCIceCandidateInit[];
}

export class Voip {
  private enabled = false;
  private localStream: MediaStream | null = null;
  private muted = false;
  private peers = new Map<string, Peer>();

  private analyser: AnalyserNode | null = null;
  private analyserCtx: AudioContext | null = null;
  private analyserData: Uint8Array | null = null;
  private speaking = false;
  private speakingCheckTimer = 0;

  /** Sends an opaque signaling payload to one peer, via the relay server. */
  private readonly sendSignal: (peerId: string, payload: unknown) => void;
  /** Fired when local mic activity crosses the speaking threshold. */
  public onSpeakingChange?: (speaking: boolean) => void;
  /** Fired when enable()/disable() actually changes state (e.g. mic permission denied). */
  public onStateChange?: (enabled: boolean) => void;

  constructor(sendSignal: (peerId: string, payload: unknown) => void) {
    this.sendSignal = sendSignal;
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  /** Requests the mic and starts connecting to every known peer. Returns whether it actually turned on. */
  public async enable(): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      console.warn("[Voip] Microphone permission denied or unavailable:", e);
      this.localStream = null;
      // Still "enabled" in listen-only mode — teammates' voices come through
      // even if this browser/user won't send any.
    }
    this.enabled = true;
    this.setupSpeakingDetector();
    // Attach the mic (or a recvonly intent) to every peer connection already open.
    this.peers.forEach((peer) => this.attachLocalTrack(peer));
    this.onStateChange?.(true);
    return true;
  }

  /** Stops the mic and tears down every peer connection (teammates simply go silent). */
  public disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.localStream?.getTracks().forEach((tr) => tr.stop());
    this.localStream = null;
    this.teardownSpeakingDetector();
    this.peers.forEach((_peer, id) => this.closePeer(id));
    this.peers.clear();
    this.onStateChange?.(false);
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((tr) => { tr.enabled = !muted; });
  }

  // ---------------------------------------------------------------------------
  // Peer lifecycle
  // ---------------------------------------------------------------------------

  /** Starts (or ensures) a connection to a teammate. Safe to call repeatedly. */
  public ensurePeer(peerId: string, myId: string) {
    if (!this.enabled || peerId === myId || this.peers.has(peerId)) return;
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { id: peerId, conn, audio: null, pendingCandidates: [] };
    this.peers.set(peerId, peer);

    conn.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(peerId, { kind: "ice", candidate: e.candidate.toJSON() });
    };
    conn.ontrack = (e) => {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.volume = 0; // silent until updateVolumes() places them in range
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      audio.play().catch(() => {
        // Autoplay refused: harmless — it'll start once the tab gets a
        // user gesture, which enabling VOIP itself already provided in
        // almost every browser.
      });
      peer.audio = audio;
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "failed" || conn.connectionState === "closed") {
        this.closePeer(peerId);
      }
    };

    this.attachLocalTrack(peer);

    // Deterministic initiator: the lexicographically smaller id offers, so
    // both sides learning of each other at once doesn't produce two offers.
    if (myId && peerId > myId) {
      this.makeOffer(peer);
    }
  }

  private attachLocalTrack(peer: Peer) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((tr) => peer.conn.addTrack(tr, this.localStream!));
    } else {
      peer.conn.addTransceiver("audio", { direction: "recvonly" });
    }
  }

  private async makeOffer(peer: Peer) {
    try {
      const offer = await peer.conn.createOffer();
      await peer.conn.setLocalDescription(offer);
      this.sendSignal(peer.id, { kind: "offer", sdp: offer.sdp });
    } catch (e) {
      console.warn("[Voip] Failed to create offer:", e);
    }
  }

  /** Routes an SDP offer/answer or ICE candidate from a teammate to its connection. */
  public async handleSignal(fromId: string, myId: string, payload: any) {
    if (!this.enabled || !payload || typeof payload !== "object") return;
    if (!this.peers.has(fromId)) this.ensurePeer(fromId, myId);
    const peer = this.peers.get(fromId);
    if (!peer) return;

    try {
      if (payload.kind === "offer" && typeof payload.sdp === "string") {
        await peer.conn.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await this.drainCandidates(peer);
        const answer = await peer.conn.createAnswer();
        await peer.conn.setLocalDescription(answer);
        this.sendSignal(fromId, { kind: "answer", sdp: answer.sdp });
      } else if (payload.kind === "answer" && typeof payload.sdp === "string") {
        await peer.conn.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await this.drainCandidates(peer);
      } else if (payload.kind === "ice" && payload.candidate) {
        if (peer.conn.remoteDescription) {
          await peer.conn.addIceCandidate(payload.candidate).catch(() => {});
        } else {
          peer.pendingCandidates.push(payload.candidate);
        }
      }
    } catch (e) {
      console.warn(`[Voip] Signaling error with ${fromId}:`, e);
    }
  }

  private async drainCandidates(peer: Peer) {
    const queued = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const c of queued) await peer.conn.addIceCandidate(c).catch(() => {});
  }

  /** Ends the call with one teammate (they left the room, or VOIP is turning off). */
  public closePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.conn.close();
    if (peer.audio) {
      peer.audio.pause();
      peer.audio.srcObject = null;
    }
    this.peers.delete(peerId);
  }

  // ---------------------------------------------------------------------------
  // Proximity volume
  // ---------------------------------------------------------------------------

  /** Call every frame: sets each connected teammate's volume by distance, muted off-level. */
  public updateVolumes(
    px: number, pz: number, level: number,
    remoteStates: Map<string, { x: number; z: number; level?: number }>
  ) {
    this.peers.forEach((peer) => {
      if (!peer.audio) return;
      const r = remoteStates.get(peer.id);
      if (!r || (r.level ?? 0) !== level) {
        peer.audio.volume = 0;
        return;
      }
      const dist = Math.hypot(r.x - px, r.z - pz);
      peer.audio.volume = Math.max(0, Math.min(1, 1 - dist / AUDIBLE_RANGE));
    });
  }

  // ---------------------------------------------------------------------------
  // Local speaking indicator (small UX nicety, not required for calls to work)
  // ---------------------------------------------------------------------------

  private setupSpeakingDetector() {
    if (!this.localStream) return;
    try {
      this.analyserCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.analyserCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.analyserCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);
    } catch (e) {
      console.warn("[Voip] Speaking detector unavailable:", e);
    }
  }

  private teardownSpeakingDetector() {
    this.analyserCtx?.close().catch(() => {});
    this.analyser = null;
    this.analyserCtx = null;
    this.analyserData = null;
    if (this.speaking) { this.speaking = false; this.onSpeakingChange?.(false); }
  }

  /** Call every frame (cheap; throttled internally to ~8x/s). */
  public updateSpeakingIndicator(delta: number) {
    if (!this.analyser || !this.analyserData || this.muted) {
      if (this.speaking) { this.speaking = false; this.onSpeakingChange?.(false); }
      return;
    }
    this.speakingCheckTimer += delta;
    if (this.speakingCheckTimer < 0.12) return;
    this.speakingCheckTimer = 0;

    this.analyser.getByteTimeDomainData(this.analyserData);
    let sumSq = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      const v = (this.analyserData[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.analyserData.length);
    const nowSpeaking = rms > 0.045;
    if (nowSpeaking !== this.speaking) {
      this.speaking = nowSpeaking;
      this.onSpeakingChange?.(nowSpeaking);
    }
  }

  public dispose() {
    this.disable();
  }
}

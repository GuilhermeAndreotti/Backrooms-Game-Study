/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameSettings } from "../types/game";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private humOsc1: OscillatorNode | null = null;
  private humOsc2: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  /** Echo bus: sounds that should ring in the room send a copy here (see setEcho). */
  private reverbIn: GainNode | null = null;
  private echoTarget = -1;
  private settings: GameSettings;
  private initialized = false;
  public level = 0;

  // Dynamic background procedural music system
  private musicGain: GainNode | null = null;
  private isMusicPlaying = false;
  private musicGeneration = 0;
  private currentSanity = 1.0;
  private activeMusicOscillators: OscillatorNode[] = [];
  private backgroundAmbienceEnabled = false;
  private distantAmbianceTimer: ReturnType<typeof setTimeout> | null = null;

  // Dynamic procedural breathing and heart rate state
  private breathingCycleTimer = 0;
  private nextBreathPhase = "inhale";

  constructor(settings: GameSettings, level = 0) {
    this.settings = settings;
    this.level = level;
  }

  /**
   * Initializes the AudioContext after user interaction to bypass browser policies.
   */
  public init() {
    if (this.initialized) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      
      // Master volume node
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.settings.volumeMaster, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.buildReverb();

      this.initialized = true;
      this.setBackgroundAmbienceEnabled(this.backgroundAmbienceEnabled);
      console.log("Web Audio API Initialized Successfully");
    } catch (e) {
      console.error("Failed to initialize audio:", e);
    }
  }

  /**
   * A synthetic room: a few discrete early reflections (the slap-back you hear
   * in an empty hall) over a dark, 2.8 s decaying tail. Its input level is
   * driven by setEcho() from how open/empty the listener's surroundings are.
   */
  private buildReverb() {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    const taps: [number, number][] = [[0.11, 0.55], [0.23, 0.4], [0.37, 0.28], [0.54, 0.18], [0.76, 0.1]];
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * 0.35;
      for (const [at, amp] of taps) {
        // Slightly different per ear, so the echo feels like it comes off walls around you.
        const start = Math.floor((at + ch * 0.013) * ctx.sampleRate);
        for (let k = 0; k < 220; k++) d[start + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 60);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 3200;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.1;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    this.reverbIn.connect(dark);
    dark.connect(conv);
    conv.connect(out);
    out.connect(this.masterGain);
  }

  /** How much the listener's surroundings echo, 0 (cramped/cluttered) .. 1 (empty hall, tiled pool). */
  public setEcho(amount: number) {
    if (!this.ctx || !this.reverbIn) return;
    const target = 0.05 + Math.max(0, Math.min(1, amount)) * 0.65;
    if (Math.abs(target - this.echoTarget) < 0.02) return;
    this.echoTarget = target;
    this.reverbIn.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  /** Sends a copy of `node` into the echo bus, scaled by `amount`. */
  private toReverb(node: AudioNode, amount = 1) {
    if (!this.ctx || !this.reverbIn) return;
    if (amount === 1) { node.connect(this.reverbIn); return; }
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverbIn);
  }

  /**
   * Wading: a low slosh of displaced water, a few bubbles, and (running) a
   * bright splash on top. Played into `dest` so callers pan/echo it.
   */
  private waterSlosh(t: number, speed: 'walk' | 'run' | 'crouch', vol: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const dur = speed === 'run' ? 0.5 : speed === 'crouch' ? 0.34 : 0.42;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(speed === 'run' ? 1300 : 850, t + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);

    if (speed === 'run') {
      const sp = ctx.createBufferSource();
      sp.buffer = this.noise();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(vol * 0.55, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      sp.connect(hp); hp.connect(sg); sg.connect(dest);
      sp.start(t, Math.random() * 1.5, 0.2);
    }

    // Bubbles: short rising blips as the water closes behind the foot.
    const bubbles = speed === 'crouch' ? 1 : 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < bubbles; i++) {
      const at = t + 0.06 + Math.random() * dur * 0.6;
      const o = ctx.createOscillator();
      o.type = "sine";
      const f = 280 + Math.random() * 420;
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * 2.4, at + 0.05);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(vol * 0.18, at);
      bg.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
      o.connect(bg); bg.connect(dest);
      o.start(at); o.stop(at + 0.07);
    }
  }

  /** A footstep in the pool's water (local or a teammate's, via pan/volume). */
  public playWaterStep(speed: 'walk' | 'run' | 'crouch', pan = 0, volume = 1) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const t = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.masterGain);
    this.toReverb(panner);
    const base = speed === 'run' ? 0.85 : speed === 'crouch' ? 0.3 : 0.6;
    this.waterSlosh(t, speed, base * volume * this.settings.volumeSfx, panner);
  }

  /**
   * A monster's footfall: a heavy, low thud with a claw/skin scrape, pushed
   * harder into the echo bus than the players' steps — you hear them coming
   * down the hall before you see them.
   * `weight` 0..1 (light/skittering .. massive).
   */
  public playMobFootstep(weight: number, volume: number, pan: number, inWater: boolean) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const vol = Math.min(1, volume) * this.settings.volumeSfx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.masterGain);
    this.toReverb(panner, 1.6);

    const dur = 0.14 + weight * 0.14;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(95 - weight * 45, t);
    o.frequency.exponentialRampToValueAtTime(22, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * (0.45 + weight * 0.5), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(og); og.connect(panner);
    o.start(t); o.stop(t + dur + 0.02);

    const scrape = ctx.createBufferSource();
    scrape.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700 + (1 - weight) * 1200;
    bp.Q.value = 2.2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(vol * 0.18, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    scrape.connect(bp); bp.connect(sg); sg.connect(panner);
    scrape.start(t, Math.random() * 1.5, 0.1);

    if (inWater) this.waterSlosh(t, weight > 0.6 ? 'run' : 'walk', vol * 0.8, panner);
  }

  public setSettings(settings: GameSettings) {
    this.settings = settings;
    if (!this.initialized) return;

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.linearRampToValueAtTime(settings.volumeMaster, this.ctx.currentTime + 0.1);
    }
    if (this.humGain && this.ctx) {
      const scale = this.level === 1 ? 0.08 : 0.12;
      this.humGain.gain.linearRampToValueAtTime(settings.volumeHum * scale, this.ctx.currentTime + 0.1); // Scaled hum to be ambient
    }
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.linearRampToValueAtTime(settings.volumeHum * 0.15, this.ctx.currentTime + 0.1); // Scaled music volume
    }
  }

  /** Enables the level ambience while keeping lobby effects and controls audible. */
  public setBackgroundAmbienceEnabled(enabled: boolean) {
    this.backgroundAmbienceEnabled = enabled;
    if (!this.initialized) return;

    if (!enabled) {
      this.stopFluorescentHum();
      this.stopDistantAmbianceScheduler();
      this.stopBackgroundMusic();
      return;
    }

    this.stopFluorescentHum();
    this.startFluorescentHum();
    this.startDistantAmbianceScheduler();
    this.startBackgroundMusic();
  }

  private stopFluorescentHum() {
    if (this.humOsc1) { try { this.humOsc1.stop(); this.humOsc1.disconnect(); } catch {} }
    if (this.humOsc2) { try { this.humOsc2.stop(); this.humOsc2.disconnect(); } catch {} }
    this.humOsc1 = null;
    this.humOsc2 = null;
    this.humGain = null;
  }

  /**
   * Generates a persistent double-oscillator hum representing cheap neon tube gas.
   */
  public startFluorescentHum() {
    if (!this.ctx || !this.masterGain) return;

    if (this.level === 1) {
      // Deeper, ominous low-frequency industrial drone for Level 1 raw warehouse
      this.humOsc1 = this.ctx.createOscillator();
      this.humOsc1.type = "sine";
      this.humOsc1.frequency.setValueAtTime(45, this.ctx.currentTime); // 45 Hz heavy sub-bass drone of boilers

      this.humOsc2 = this.ctx.createOscillator();
      this.humOsc2.type = "triangle";
      this.humOsc2.frequency.setValueAtTime(90, this.ctx.currentTime); // 90 Hz transformer rumble

      const lpFilter = this.ctx.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.setValueAtTime(110, this.ctx.currentTime); // clip high buzzes
      lpFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

      this.humGain = this.ctx.createGain();
      const initialHumVolume = this.settings.volumeHum * 0.08;
      this.humGain.gain.setValueAtTime(initialHumVolume, this.ctx.currentTime);

      // Connect flow
      this.humOsc1.connect(lpFilter);
      this.humOsc2.connect(lpFilter);
      lpFilter.connect(this.humGain);
      this.humGain.connect(this.masterGain);

      this.humOsc1.start();
      this.humOsc2.start();
    } else {
      // First oscillator at 60Hz (sub-bass hum)
      this.humOsc1 = this.ctx.createOscillator();
      this.humOsc1.type = "sawtooth";
      this.humOsc1.frequency.setValueAtTime(60, this.ctx.currentTime);

      // Second oscillator at 120Hz (distorted buzz)
      this.humOsc2 = this.ctx.createOscillator();
      this.humOsc2.type = "sine";
      this.humOsc2.frequency.setValueAtTime(120, this.ctx.currentTime);

      // Filter to clip harshness and simulate walls/ballast housing
      const lpFilter = this.ctx.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.setValueAtTime(140, this.ctx.currentTime);
      lpFilter.Q.setValueAtTime(4, this.ctx.currentTime);

      this.humGain = this.ctx.createGain();
      const initialHumVolume = this.settings.volumeHum * 0.12; // Cap it so it doesn't blast ears
      this.humGain.gain.setValueAtTime(initialHumVolume, this.ctx.currentTime);

      // Connect flow
      this.humOsc1.connect(lpFilter);
      this.humOsc2.connect(lpFilter);
      lpFilter.connect(this.humGain);
      this.humGain.connect(this.masterGain);

      // Play hums
      this.humOsc1.start();
      this.humOsc2.start();
    }
  }

  /**
   * Modulates fluorescent hum dynamically during flickers to feel realistic.
   */
  public triggerHumFlicker(durationMs: number) {
    if (!this.ctx || !this.humGain) return;

    const t = this.ctx.currentTime;
    const baseHum = this.settings.volumeHum * 0.12;

    // Rapid drop to 0 and back to mimic a gaseous discharge bulb cutting out
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(baseHum, t);
    
    // Play a sequence of flicker cutoffs
    this.humGain.gain.setValueAtTime(0, t + 0.02);
    this.humGain.gain.setValueAtTime(baseHum * 0.3, t + 0.08);
    this.humGain.gain.setValueAtTime(0, t + 0.12);
    this.humGain.gain.setValueAtTime(baseHum * 0.1, t + 0.16);
    this.humGain.gain.linearRampToValueAtTime(baseHum, t + (durationMs / 1000));

    // Play static spark clicks
    this.playSparkClick(t);
    this.playSparkClick(t + 0.12);
  }

  private playSparkClick(time: number) {
    if (!this.ctx || !this.masterGain) return;

    // Buffer for static click sound
    const size = this.ctx.sampleRate * 0.04; // 40ms of static crackle
    const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < size; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.3));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const hpFilter = this.ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.setValueAtTime(1000, time);

    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(this.settings.volumeSfx * 0.22, time);

    noise.connect(hpFilter);
    hpFilter.connect(clickGain);
    clickGain.connect(this.masterGain);

    noise.start(time);
  }

  /**
   * Synthesizes realistic 3D spatialized footstep sounds locally.
   * @param speed 'walk' | 'run' | 'crouch'
   * @param pan -1.0 to 1.0 (spatial placement for multiplayer players)
   * @param isWet boolean flag whether the footstep lands on wet/moist carpet
   */
  public playFootstep(speed: 'walk' | 'run' | 'crouch', pan = 0.0, isWet = false, volumeScale = 1) {
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;
    
    // Create base low-frequency hollow thud for carpet impact
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";

    // Set parameters depending on pace
    let pitchStart = 85;
    let pitchEnd = 20;
    let duration = 0.12;
    let volume = 0.5;

    if (speed === 'run') {
      pitchStart = 110;
      pitchEnd = 30;
      duration = 0.15;
      volume = 0.85;
    } else if (speed === 'crouch') {
      pitchStart = 60;
      pitchEnd = 15;
      duration = 0.08;
      volume = 0.2;
    }

    volume *= volumeScale;
    osc.frequency.setValueAtTime(pitchStart, t);
    osc.frequency.exponentialRampToValueAtTime(pitchEnd, t + duration);

    // White noise layer for the soft shoe-on-wet-carpet rustle
    const bufferSize = this.ctx.sampleRate * duration;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / bufferSize); // Envelope noise
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const lpNoise = this.ctx.createBiquadFilter();
    lpNoise.type = "bandpass";
    lpNoise.frequency.setValueAtTime(250, t);
    lpNoise.Q.setValueAtTime(1, t);

    // Audio gains
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(volume * 0.8 * this.settings.volumeSfx, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.2 * this.settings.volumeSfx, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    // Spatial panning
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, t);

    // Node plumbing
    osc.connect(oscGain);
    oscGain.connect(panner);

    noiseSource.connect(lpNoise);
    lpNoise.connect(noiseGain);
    noiseGain.connect(panner);

    panner.connect(this.masterGain);
    this.toReverb(panner);

    // Trigger footstep sound
    osc.start(t);
    osc.stop(t + duration);
    noiseSource.start(t);
    noiseSource.stop(t + duration);

    // If on damp carpet, overlay a wet squishy water compression sound
    if (isWet) {
      const wetBufferSize = this.ctx.sampleRate * (duration * 1.3);
      const wetBuffer = this.ctx.createBuffer(1, wetBufferSize, this.ctx.sampleRate);
      const wetData = wetBuffer.getChannelData(0);
      for (let i = 0; i < wetBufferSize; i++) {
        // High frequency squelch with logarithmic dampening to sound watery
        wetData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (wetBufferSize * 0.2));
      }

      const wetSource = this.ctx.createBufferSource();
      wetSource.buffer = wetBuffer;

      const hpWet = this.ctx.createBiquadFilter();
      hpWet.type = "bandpass";
      hpWet.frequency.setValueAtTime(1600, t);
      hpWet.Q.setValueAtTime(1.8, t);

      const wetGain = this.ctx.createGain();
      wetGain.gain.setValueAtTime(volume * 0.48 * this.settings.volumeSfx, t);
      wetGain.gain.exponentialRampToValueAtTime(0.001, t + duration * 1.25);

      wetSource.connect(hpWet);
      hpWet.connect(wetGain);
      wetGain.connect(panner);

      wetSource.start(t);
      wetSource.stop(t + duration * 1.3);
    }
  }

  /** A misleading off-screen footstep pattern used by Eco while hunting. */
  public playFalseFootsteps(pan = 0, wet = false) {
    if (!this.ctx || !this.masterGain) return;
    this.playFootstep("walk", pan, wet);
    window.setTimeout(() => this.playFootstep("walk", pan * 0.8, wet), 155);
    window.setTimeout(() => this.playFootstep("walk", pan * 0.55, wet), 320);
  }

  /**
   * Synthesizes a wet water droplet drip plopping from the damp ceiling.
   * Ramps frequency exponentially from mid-range to high-pitch.
   */
  public playWaterDrip(pan = 0.0, volumeScale = 1.0) {
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    
    const startFreq = 480 + Math.random() * 60;
    const endFreq = 1400 + Math.random() * 150;
    
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.055);

    const gain = this.ctx.createGain();
    const initialVol = 0.075 * volumeScale * this.settings.volumeSfx;
    gain.gain.setValueAtTime(initialVol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, t);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    this.toReverb(panner);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  /**
   * Periodic scheduler that generates haunting, sparse distant mechanical echoes and pipeline thuds.
   */
  private startDistantAmbianceScheduler() {
    if (!this.ctx || !this.backgroundAmbienceEnabled || this.distantAmbianceTimer) return;

    const nextDelaySec = 15 + Math.random() * 20;
    this.distantAmbianceTimer = setTimeout(() => {
      this.distantAmbianceTimer = null;
      if (!this.backgroundAmbienceEnabled || !this.ctx || !this.masterGain) return;
      this.triggerDistantEchoSound();
      this.startDistantAmbianceScheduler();
    }, nextDelaySec * 1000);
  }

  private stopDistantAmbianceScheduler() {
    if (this.distantAmbianceTimer) clearTimeout(this.distantAmbianceTimer);
    this.distantAmbianceTimer = null;
  }

  private triggerDistantEchoSound() {
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;
    console.log("Triggered distant psychological echo SFX on Level", this.level);

    if (this.level === 1) {
      if (Math.random() > 0.5) {
        // Deep Boiler Metal Bang: low-frequency heavy metallic strike
        const strikeOsc = this.ctx.createOscillator();
        strikeOsc.type = "sawtooth";
        strikeOsc.frequency.setValueAtTime(65, t);
        strikeOsc.frequency.exponentialRampToValueAtTime(30, t + 0.8);

        // Low-pass to simulate hearing it through concrete walls
        const wallFilter = this.ctx.createBiquadFilter();
        wallFilter.type = "lowpass";
        wallFilter.frequency.setValueAtTime(180, t);

        const strikeGain = this.ctx.createGain();
        strikeGain.gain.setValueAtTime(0.001, t);
        strikeGain.gain.linearRampToValueAtTime(0.35 * this.settings.volumeSfx, t + 0.05); // heavy strike impact
        strikeGain.gain.exponentialRampToValueAtTime(0.001, t + 3.8); // slow rumble decay

        const panNode = this.ctx.createStereoPanner();
        panNode.pan.setValueAtTime(Math.random() * 2 - 1, t);

        strikeOsc.connect(wallFilter);
        wallFilter.connect(strikeGain);
        strikeGain.connect(panNode);
        panNode.connect(this.masterGain);

        strikeOsc.start(t);
        strikeOsc.stop(t + 4);
      } else {
        // Pressurized Steam Valve Sizzling/Relief Release (procedurally synthesized steam!)
        const bufferSize = this.ctx.sampleRate * 2.5; // 2.5 seconds hiss
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const steamSource = this.ctx.createBufferSource();
        steamSource.buffer = buffer;

        const bandFilter = this.ctx.createBiquadFilter();
        bandFilter.type = "bandpass";
        bandFilter.frequency.setValueAtTime(1600, t); // high-pitched steam whistling hiss
        bandFilter.Q.setValueAtTime(1.8, t);

        const steamGain = this.ctx.createGain();
        steamGain.gain.setValueAtTime(0.001, t);
        steamGain.gain.linearRampToValueAtTime(0.12 * this.settings.volumeSfx, t + 0.4); // swell
        steamGain.gain.exponentialRampToValueAtTime(0.001, t + 2.4); // decay

        const panNode = this.ctx.createStereoPanner();
        panNode.pan.setValueAtTime(Math.random() * 1.6 - 0.8, t);

        steamSource.connect(bandFilter);
        bandFilter.connect(steamGain);
        steamGain.connect(panNode);
        panNode.connect(this.masterGain);

        steamSource.start(t);
      }
    } else {
      // Sub-bass rumble or high resonate ring (50% chance each)
      if (Math.random() > 0.5) {
        // Deep wall mechanical drone
        const rumbleOsc = this.ctx.createOscillator();
        rumbleOsc.type = "sine";
        rumbleOsc.frequency.setValueAtTime(32, t); // 32 Hz extremely low rumble
        
        const rumbleGain = this.ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.001, t);
        rumbleGain.gain.linearRampToValueAtTime(0.25 * this.settings.volumeSfx, t + 1.5);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 4.5);

        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(this.masterGain);

        rumbleOsc.start(t);
        rumbleOsc.stop(t + 5);
      } else {
        // Distant pipe clang/clangor with high reverberation
        const clangOsc = this.ctx.createOscillator();
        clangOsc.type = "triangle";
        clangOsc.frequency.setValueAtTime(140 + Math.random() * 80, t);

        // Low pass to simulate wall obstruction (removes high-end)
        const wallFilter = this.ctx.createBiquadFilter();
        wallFilter.type = "lowpass";
        wallFilter.frequency.setValueAtTime(220, t);

        const clangGain = this.ctx.createGain();
        clangGain.gain.setValueAtTime(0.001, t);
        clangGain.gain.linearRampToValueAtTime(0.18 * this.settings.volumeSfx, t + 0.05);
        clangGain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);

        // Random pan (left or right ear)
        const panNode = this.ctx.createStereoPanner();
        panNode.pan.setValueAtTime(Math.random() * 2 - 1, t);

        clangOsc.connect(wallFilter);
        wallFilter.connect(clangGain);
        clangGain.connect(panNode);
        panNode.connect(this.masterGain);

        clangOsc.start(t);
        clangOsc.stop(t + 3);
      }
    }
  }

  /**
   * Spooky glitched spatial folding synthesizer sweep for the noclip escape event
   */
  public playGlitchNoclipSound() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(10, t + 0.95);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.setValueAtTime(800, t);
    filter.Q.setValueAtTime(15, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.settings.volumeSfx * 0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.95);

    // Dynamic series of statics
    for (let i = 0; i < 10; i++) {
      this.playSparkClick(t + i * 0.07);
    }
  }

  /**
   * Loud dramatic synthesized analog tape distortion jumpscare when caught by the wandering parasite.
   */
  public playEntityCatchSound() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    // High frequency scream
    const screamOsc = this.ctx.createOscillator();
    screamOsc.type = "sawtooth";
    screamOsc.frequency.setValueAtTime(680, t);
    screamOsc.frequency.exponentialRampToValueAtTime(120, t + 1.2);

    // Deep heavy low-pass impact
    const subOsc = this.ctx.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(90, t);
    subOsc.frequency.linearRampToValueAtTime(30, t + 1.2);

    // Filter to add heavy vintage telephone resonance
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(450, t);
    filter.Q.setValueAtTime(8, t);

    const mainGain = this.ctx.createGain();
    mainGain.gain.setValueAtTime(this.settings.volumeSfx * 1.2, t);
    mainGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

    screamOsc.connect(filter);
    subOsc.connect(mainGain);
    filter.connect(mainGain);
    mainGain.connect(this.masterGain);

    screamOsc.start(t);
    subOsc.start(t);
    screamOsc.stop(t + 1.2);
    subOsc.stop(t + 1.2);

    // Immediate severe flicker of the hum to add extra dread
    this.triggerHumFlicker(350);
  }

  /**
   * Updates dynamic procedural breathing sounds and heart rates based on fatigue level (1 - stamina) and sanity level.
   */
  public updateBreathing(stamina: number, dt: number, sanity: number = 1.0) {
    this.currentSanity = sanity;
    if (!this.initialized || !this.ctx || !this.masterGain) return;

    // Calm breathing is extremely quiet/silent; exhaustion or panic (low sanity) triggers loud, fast, and desperate breathing.
    const tension = Math.max(1.0 - stamina, 1.0 - sanity); // 0.0 to 1.0 (empty stamina or low sanity means high tension)
    if (tension < 0.05) {
      // Extremely relaxed state, clear timer to prevent instant breath upon starting to sprint
      this.breathingCycleTimer = 0.5;
      return;
    }

    this.breathingCycleTimer -= dt;
    if (this.breathingCycleTimer <= 0) {
      const isExhausted = tension > 0.45;
      const volumeScale = tension * (isExhausted ? 1.0 : 0.35); // volume amplifies under extreme strain
      const speedMultiplier = 1.0 + tension * 1.6; // stamina-dependent fast breath speed

      const baseDuration = this.nextBreathPhase === "inhale" ? 0.62 : 0.82;
      const duration = baseDuration / speedMultiplier;

      // Synthesize individual inhale or exhale sound sweep
      this.playBreathSynth(this.nextBreathPhase === "inhale", duration, volumeScale);

      // Trigger a raw heavy double heartbeat if tension is severe (> 0.5) right alongside breathing
      if (tension > 0.42 && this.nextBreathPhase === "inhale") {
        this.playHeartbeat(tension);
      }

      // Schedule next breath phase
      if (this.nextBreathPhase === "inhale") {
        this.nextBreathPhase = "exhale";
        this.breathingCycleTimer = duration + 0.1 / speedMultiplier; // pause after inhale
      } else {
        this.nextBreathPhase = "inhale";
        this.breathingCycleTimer = duration + 0.28 / speedMultiplier; // pause after exhale
      }
    }
  }

  /**
   * Synthesizes breathing sounds procedurally using bandpass and lowpass filtered brownian noise.
   */
  private playBreathSynth(isInhale: boolean, duration: number, volumeScale: number) {
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;
    
    // Create soft brownian noise buffer for throat airflow
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    let lastValue = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brownian filtered lowpass walk for warmer breathing tones rather than generic digital hiss
      data[i] = (lastValue + (0.07 * white)) / 1.07;
      lastValue = data[i];
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;

    // airway tract filter modeling
    const bpFilter = this.ctx.createBiquadFilter();
    bpFilter.type = "bandpass";
    
    // Inhaling is a higher-pitched draft, exhaling is a deeper sighing release
    const startFreq = isInhale ? 340 : 620;
    const endFreq = isInhale ? 680 : 250;
    
    bpFilter.frequency.setValueAtTime(startFreq, t);
    bpFilter.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    bpFilter.Q.setValueAtTime(2.2, t); // resonance

    const lpFilter = this.ctx.createBiquadFilter();
    lpFilter.type = "lowpass";
    lpFilter.frequency.setValueAtTime(1200, t); // eliminate any residual dynamic click or hiss

    const breathGain = this.ctx.createGain();
    const maxVolume = 0.32 * volumeScale * this.settings.volumeSfx;

    if (isInhale) {
      breathGain.gain.setValueAtTime(0.001, t);
      breathGain.gain.linearRampToValueAtTime(maxVolume * 0.95, t + duration * 0.7);
      breathGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    } else {
      breathGain.gain.setValueAtTime(maxVolume * 1.15, t);
      breathGain.gain.exponentialRampToValueAtTime(maxVolume * 0.12, t + duration * 0.8);
      breathGain.gain.setValueAtTime(0.001, t + duration);
    }

    noiseSource.connect(bpFilter);
    bpFilter.connect(lpFilter);
    lpFilter.connect(breathGain);
    breathGain.connect(this.masterGain);

    noiseSource.start(t);
    noiseSource.stop(t + duration);
  }

  /**
   * Generates a deep, dread-inducing sub-bass double heartbeat "lub-dub".
   */
  private playHeartbeat(volumeScale: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const baseBeatVol = 0.45 * volumeScale * this.settings.volumeSfx;

    // 1. "Lub" First Beat (Lower frequency and punchy)
    const osc1 = this.ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(58, t);
    osc1.frequency.exponentialRampToValueAtTime(8, t + 0.12);

    const gain1 = this.ctx.createGain();
    gain1.gain.setValueAtTime(baseBeatVol, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    osc1.start(t);
    osc1.stop(t + 0.13);

    // 2. "Dub" Second Beat (slightly delayed, softer, higher frequency)
    const osc2 = this.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(48, t + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(8, t + 0.27);

    const gain2 = this.ctx.createGain();
    gain2.gain.setValueAtTime(baseBeatVol * 0.65, t + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.27);

    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(t + 0.15);
    osc2.stop(t + 0.28);
  }

  /**
   * Starts the evolving background procedural ambient music scheduler.
   */
  public startBackgroundMusic() {
    if (!this.ctx || !this.masterGain || this.isMusicPlaying) return;
    this.isMusicPlaying = true;
    const musicGeneration = ++this.musicGeneration;

    // Create a music-specific gain node
    this.musicGain = this.ctx.createGain();
    // Default music volume is slightly quieter than hum to make it a perfect background texture
    const initialMusicVolume = this.settings.volumeHum * 0.15;
    this.musicGain.gain.setValueAtTime(initialMusicVolume, this.ctx.currentTime);
    this.musicGain.connect(this.masterGain);

    const playNextChord = () => {
      if (!this.initialized || !this.ctx || !this.isMusicPlaying || musicGeneration !== this.musicGeneration) return;

      // Calculate time for this chord loop
      const chordDuration = 12 + Math.random() * 8; // Each chord pad runs for 12 to 20 seconds
      this.triggerAmbientChord(chordDuration);

      // Schedule next chord slightly before this one finishes to create a crossfade overlay!
      const nextDelay = (chordDuration - 2) * 1000;
      setTimeout(() => {
        playNextChord();
      }, nextDelay);
    };

    // Trigger first chord after a tiny initial delay
    setTimeout(() => {
      playNextChord();
    }, 1000);
  }

  private stopBackgroundMusic() {
    this.musicGeneration++;
    this.isMusicPlaying = false;
    this.activeMusicOscillators.forEach((osc) => {
      try { osc.stop(); osc.disconnect(); } catch {}
    });
    this.activeMusicOscillators = [];
    this.musicGain?.disconnect();
    this.musicGain = null;
  }

  /**
   * Procedurally synthesizes a slow, sweeping eerie ambient chord pad that reacts to player sanity.
   */
  private triggerAmbientChord(duration: number) {
    if (!this.ctx || !this.musicGain || !this.isMusicPlaying) return;

    const t = this.ctx.currentTime;
    
    // Choose dynamic notes based on player sanity for high atmospheric tension!
    let notes: number[] = [];
    if (this.currentSanity >= 0.70) {
      // High Sanity: Mysterious, hollow, immersive drone chords (Perfect fifths, minor thirds)
      notes = [82.41, 123.47, 164.81, 196.00];
    } else if (this.currentSanity >= 0.40) {
      // Medium Sanity: Tension building, unstable intervals (Tritones, suspended fourths)
      notes = [87.31, 123.47, 130.81, 174.61];
    } else {
      // Low Sanity: Discordant acoustic dread, screechy close-interval cluster notes
      notes = [82.41, 87.31, 92.50, 207.65];
      if (Math.random() < 0.6) {
        notes.push(466.16); // A#4 tritone screech
      }
      if (Math.random() < 0.3) {
        notes.push(493.88); // B4 screech
      }
    }

    // High sanity has a lower, warmer lowpass filter. Low sanity opens the filter for harsh, cold frequencies.
    const filterFrequency = this.currentSanity >= 0.70 ? 220 
                          : this.currentSanity >= 0.40 ? 440 
                          : 1100;

    // Create a shared lowpass filter for this chord pad
    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.setValueAtTime(filterFrequency, t);
    padFilter.Q.setValueAtTime(1.5, t);
    padFilter.connect(this.musicGain);

    const activeOscs: OscillatorNode[] = [];

    notes.forEach((freq, index) => {
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const nodeGain = this.ctx.createGain();

      // Dissonance and detuning increases as sanity drops to simulate psychological breakdown
      const detuneAmt = this.currentSanity >= 0.70 ? 2 
                      : this.currentSanity >= 0.40 ? 12
                      : 45; // extreme microtonal detune creating beating and anxiety
      
      osc.type = index === 0 ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime((Math.random() * 2 - 1) * detuneAmt, t);

      // Low sanity adds a dynamic pitch drift (LFO vibrato)
      if (this.currentSanity < 0.40 && index > 1) {
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.setValueAtTime(3.0 + Math.random() * 4.0, t); // fast paranoid vibration
        lfoGain.gain.setValueAtTime(8, t); // ±8 cents frequency drift
        
        lfo.connect(lfoGain);
        lfoGain.connect(osc.detune);
        lfo.start(t);
        lfo.stop(t + duration);
      }

      // Smooth volume envelope: fade-in -> sustain -> fade-out
      const noteVol = (index === 0 ? 0.08 : 0.05); // low notes slightly louder
      nodeGain.gain.setValueAtTime(0.001, t);
      nodeGain.gain.linearRampToValueAtTime(noteVol, t + (duration * 0.3)); // slow fade-in
      nodeGain.gain.setValueAtTime(noteVol, t + (duration * 0.6)); // hold
      nodeGain.gain.exponentialRampToValueAtTime(0.001, t + duration); // slow fade-out

      osc.connect(nodeGain);
      nodeGain.connect(padFilter);

      osc.start(t);
      osc.stop(t + duration);

      activeOscs.push(osc);
      this.activeMusicOscillators.push(osc);
    });

    // Clean up activeMusicOscillators array when this chord finishes playing
    setTimeout(() => {
      this.activeMusicOscillators = this.activeMusicOscillators.filter(o => !activeOscs.includes(o));
    }, duration * 1000);
  }

  // ---------------------------------------------------------------------------
  // Level G
  // ---------------------------------------------------------------------------

  private alarmOscillators: OscillatorNode[] = [];

  /**
   * The Finger King's warning: a few quick knuckle/nail taps, like fingers
   * drumming on a desk, a metal locker or a window. `volume` 0..1 rises as
   * it gets closer; `count` is how many taps (it "counts" up as it nears);
   * `delay` schedules the whole burst that many seconds from now.
   */
  public playFingerTap(volume: number, pan = 0, surface: "wood" | "metal" | "glass" = "wood", count?: number, delay = 0) {
    if (!this.ctx || !this.masterGain || volume <= 0.01) return;
    const t0 = this.ctx.currentTime + delay;
    const taps = count ?? 2 + Math.floor(Math.random() * 3);
    const out = this.kingOut(volume, pan, 0.9);

    // One short noise burst shared by every tap
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);

    const [freq, q, ring] = surface === "metal" ? [3200, 14, 0.18] : surface === "glass" ? [4600, 20, 0.12] : [1800, 6, 0.06];
    for (let k = 0; k < taps; k++) {
      const t = t0 + k * (0.07 + Math.random() * 0.05);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(freq + Math.random() * 900, t);
      band.Q.setValueAtTime(q, t);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + ring);
      src.connect(band);
      band.connect(gain);
      gain.connect(out);
      src.start(t);
      src.stop(t + ring + 0.02);
      // The nail itself: a tiny click on top
      if (surface !== "wood") this.kingOsc("sine", freq * 1.9, freq * 1.7, 0.05, 0.12, out, t);
    }
    this.kingRelease(out, delay + 1.2);
  }

  /**
   * One tap at each of `offsets` (seconds from now): the Finger King playing
   * back a rhythm it heard — the explorer's own footsteps.
   */
  public playFingerTapPattern(offsets: number[], volume: number, pan: number, surface: "wood" | "metal" | "glass" = "wood") {
    for (const o of offsets) this.playFingerTap(volume, pan, surface, 1, o);
  }

  /** A positional gain → panner chain into the master (and some reverb). Callers must kingRelease() it. */
  private kingOut(volume: number, pan: number, reverb = 1): GainNode {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = Math.min(1.5, volume) * this.settings.volumeSfx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.masterGain!);
    if (reverb > 0) this.toReverb(panner, reverb);
    (out as GainNode & { __panner?: StereoPannerNode }).__panner = panner;
    return out;
  }

  private kingRelease(out: GainNode, afterSeconds: number) {
    setTimeout(() => {
      try {
        out.disconnect();
        (out as GainNode & { __panner?: StereoPannerNode }).__panner?.disconnect();
      } catch { /* already gone */ }
    }, afterSeconds * 1000);
  }

  private kingOsc(kind: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, at: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = kind;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  private kingNoise(dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, dest: AudioNode, at: number, attack = 0.005) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(at, Math.random());
    src.stop(at + dur + 0.05);
    return f;
  }

  /** A dry joint crack on each of its steps: a knuckle popping, far too loud. */
  public playKingJointCrack(volume: number, pan: number) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const t = this.ctx.currentTime;
    const out = this.kingOut(volume, pan, 0.6);
    const pops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) {
      const at = t + i * (0.018 + Math.random() * 0.03);
      this.kingNoise(0.035, "bandpass", 900 + Math.random() * 1400, 3, 0.8, out, at, 0.001);
      this.kingOsc("triangle", 180 + Math.random() * 80, 60, 0.05, 0.35, out, at);
    }
    this.kingRelease(out, 0.6);
  }

  /** Slow wet nasal breathing, close by. `inhale` rises, the exhale sinks and rattles. */
  public playKingBreath(volume: number, pan: number, inhale: boolean) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const t = this.ctx.currentTime;
    const dur = inhale ? 1.3 : 1.7;
    const out = this.kingOut(volume, pan, 0.4);
    const f = this.kingNoise(dur, "bandpass", inhale ? 700 : 500, 1.4, 0.5, out, t, dur * 0.45);
    f.frequency.setValueAtTime(inhale ? 500 : 800, t);
    f.frequency.linearRampToValueAtTime(inhale ? 1300 : 350, t + dur);
    if (!inhale) {
      // A rattle in the throat
      const rattle = this.kingOsc("sawtooth", 38, 30, dur * 0.8, 0.12, out, t + 0.2);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 17;
      const lg = this.ctx.createGain();
      lg.gain.value = 12;
      lfo.connect(lg);
      lg.connect(rattle.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    this.kingRelease(out, dur + 0.5);
  }

  /**
   * Whispering that is almost words: formant-filtered noise hopping between
   * vowel shapes. `deep` (while it stares at you) adds a pitched-down voice
   * under it.
   */
  public playKingWhisper(volume: number, pan: number, deep: boolean) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const syllables = 3 + Math.floor(Math.random() * 4);
    const out = this.kingOut(volume, pan, 1.4);
    // [F1, F2] of a few vowels
    const vowels: [number, number][] = [[800, 1200], [400, 2000], [300, 870], [500, 1000], [350, 2300]];
    let at = t;
    for (let i = 0; i < syllables; i++) {
      const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
      const dur = 0.12 + Math.random() * 0.18;
      this.kingNoise(dur, "bandpass", f1, 7, 0.55, out, at, 0.03);
      this.kingNoise(dur, "bandpass", f2, 9, 0.35, out, at, 0.03);
      this.kingNoise(0.05, "highpass", 5000, 1, 0.25, out, at, 0.005); // sibilant
      if (deep) {
        const v = this.kingOsc("sawtooth", 62 + Math.random() * 8, 48, dur * 1.3, 0.2, out, at);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 420;
        v.disconnect();
        v.connect(lp);
        const vg = ctx.createGain();
        vg.gain.setValueAtTime(0.0001, at);
        vg.gain.exponentialRampToValueAtTime(0.45, at + 0.04);
        vg.gain.exponentialRampToValueAtTime(0.0001, at + dur * 1.3);
        lp.connect(vg);
        vg.connect(out);
      }
      at += dur + 0.03 + Math.random() * 0.12;
    }
    this.kingRelease(out, at - t + 1);
  }

  /**
   * The hunt begins: a dissonant cluster of synthetic strings swelling over
   * a falling sub-drop, with the office hum cut dead underneath it.
   */
  public playKingStinger() {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.kingOut(0.9, 0, 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + 0.35);
    lp.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    lp.connect(out);
    for (const f of [233, 247, 262, 349, 370, 494, 523]) {
      const o = this.kingOsc("sawtooth", f, f * 0.94, 2.4, 0.07, lp, t);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5 + Math.random() * 3;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.012;
      vib.connect(vg);
      vg.connect(o.frequency);
      vib.start(t);
      vib.stop(t + 2.5);
    }
    this.kingOsc("sine", 90, 28, 1.8, 0.9, out, t);
    this.kingNoise(0.4, "lowpass", 300, 1, 0.6, out, t, 0.002);
    this.kingRelease(out, 3.5);
    this.cutHum(2.6);
  }

  /** Something heavy lands, far off — where it just appeared. */
  public playKingThud(volume: number, pan: number) {
    if (!this.ctx || !this.masterGain || volume < 0.02) return;
    const t = this.ctx.currentTime;
    const out = this.kingOut(volume, pan, 1.2);
    this.kingOsc("sine", 70, 32, 0.6, 0.9, out, t);
    this.kingNoise(0.25, "lowpass", 260, 1, 0.5, out, t, 0.002);
    this.playFingerTap(volume * 0.6, pan, "wood", 1);
    this.kingRelease(out, 1.2);
  }

  /** Three slow knocks on the closet door you're hiding behind, right by your ear. */
  public playClosetKnock() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const out = this.kingOut(1.1, (Math.random() - 0.5) * 0.4, 0.5);
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.62 + (i === 2 ? 0.25 : 0);
      this.kingNoise(0.12, "bandpass", 420, 2.5, 0.9, out, at, 0.002);
      this.kingOsc("sine", 140, 70, 0.18, 0.6, out, at);
      this.kingNoise(0.4, "bandpass", 2400, 12, 0.08, out, at + 0.01, 0.003); // locker sheet-metal ring
    }
    this.kingRelease(out, 3);
  }

  /**
   * The Finger King's kill: grinding teeth and a scream built from a
   * detuned cluster run through distortion, finger-snaps in a burst, and a
   * 40 Hz drop that you feel more than hear.
   */
  public playFingerKingScream() {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.kingOut(1.4, 0, 0.8);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 1.4);
    bp.Q.value = 1.2;
    shaper.connect(bp);
    bp.connect(out);
    for (const f of [610, 647, 689, 913]) {
      const o = this.kingOsc("sawtooth", f, f * 0.55, 1.5, 0.25, shaper, t);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23 + Math.random() * 9;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.06;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + 1.6);
    }
    // Teeth grinding: gritty pink-ish noise
    this.kingNoise(1.3, "bandpass", 2600, 0.7, 0.5, out, t, 0.01);
    // Snapping fingers
    for (let i = 0; i < 12; i++) {
      this.kingNoise(0.03, "bandpass", 2000 + Math.random() * 2000, 5, 0.9, out, t + 0.05 + i * 0.06 + Math.random() * 0.03, 0.001);
    }
    this.kingOsc("sine", 42, 25, 1.6, 1.2, out, t);
    this.kingRelease(out, 2.5);
    this.cutHum(1.8);
  }

  /** Cuts the ambient hum dead for `seconds`, then lets it creep back. */
  public cutHum(seconds: number) {
    if (!this.ctx || !this.humGain) return;
    const t = this.ctx.currentTime;
    const baseHum = this.settings.volumeHum * 0.12;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(0, t + 0.01);
    this.humGain.gain.setValueAtTime(0, t + seconds);
    this.humGain.gain.linearRampToValueAtTime(baseHum, t + seconds + 1.5);
  }

  // ---------------------------------------------------------------------
  // Monster voices — procedural, positional (pan + distance volume). Each is a
  // short synth phrase; `alert` is the aggressive version played while hunting.
  // A small voice cap keeps a Level 2 stampede from turning into white noise.
  // ---------------------------------------------------------------------
  private monsterVoices = 0;
  private noiseBuf: AudioBuffer | null = null;

  private noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const len = this.ctx!.sampleRate * 2;
      this.noiseBuf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /**
   * @param type   EntityType string
   * @param alert  true = hunting/agitated voice, false = idle murmur
   * @param volume 0..1 already attenuated by distance
   * @param pan    -1 (left) .. 1 (right)
   */
  public playMonsterSound(type: string, alert: boolean, volume: number, pan: number) {
    if (!this.ctx || !this.masterGain || volume < 0.02 || this.monsterVoices >= 4) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const vol = Math.min(1, volume) * this.settings.volumeSfx;

    const out = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.masterGain);
    this.toReverb(panner, 1.3);

    const osc = (kind: OscillatorType, f0: number, f1: number, dur: number, dest: AudioNode, at = t) => {
      const o = ctx.createOscillator();
      o.type = kind;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
      o.connect(dest);
      o.start(at);
      o.stop(at + dur + 0.05);
      return o;
    };
    const noiseBurst = (dur: number, filt: BiquadFilterType, freq: number, q: number, g: number, at = t) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filt; f.frequency.value = freq; f.Q.value = q;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(g, at);
      ng.gain.exponentialRampToValueAtTime(0.001, at + dur);
      src.connect(f); f.connect(ng); ng.connect(out);
      src.start(at, Math.random());
      src.stop(at + dur + 0.05);
    };
    const envelope = (dur: number, peak: number) => {
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(peak * vol, t + Math.min(0.08, dur / 3));
      out.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      return dur;
    };
    let dur = 1;

    switch (type) {
      case "HOUND": {
        // Idle: low rumbling growl. Alert: sharp bark-snarl.
        dur = alert ? 0.45 : 1.1;
        envelope(dur, alert ? 0.9 : 0.6);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = alert ? 900 : 350; lp.connect(out);
        const o = osc("sawtooth", alert ? 220 : 80, alert ? 90 : 60, dur, lp);
        const lfo = ctx.createOscillator(); lfo.frequency.value = alert ? 28 : 16;
        const lfoG = ctx.createGain(); lfoG.gain.value = alert ? 40 : 12;
        lfo.connect(lfoG); lfoG.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
        if (alert) noiseBurst(0.18, "bandpass", 1400, 1.2, 0.5);
        break;
      }
      case "DULLER": {
        // Something dry dragging through a wall.
        dur = alert ? 1.2 : 1.8;
        envelope(dur, 0.5);
        noiseBurst(dur, "bandpass", alert ? 380 : 220, 3, 0.9);
        osc("sine", 55, 48, dur, out);
        break;
      }
      case "CLUMP": {
        // Rattling limbs: a run of dry clicks.
        const clicks = alert ? 9 : 4;
        dur = clicks * 0.09 + 0.15;
        out.gain.setValueAtTime(vol * 0.9, t);
        for (let i = 0; i < clicks; i++) {
          noiseBurst(0.05, "bandpass", 1600 + Math.random() * 1600, 5, 0.7, t + i * (0.07 + Math.random() * 0.04));
        }
        if (alert) osc("triangle", 130, 70, dur, out);
        break;
      }
      case "SKIN_STEALER": {
        if (alert) {
          // The mask slips: warbling, distorted shriek.
          dur = 1.0;
          envelope(dur, 0.9);
          const shaper = ctx.createWaveShaper();
          const curve = new Float32Array(256);
          for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
          shaper.curve = curve; shaper.connect(out);
          const o = osc("sawtooth", 520, 260, dur, shaper);
          const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
          const lg = ctx.createGain(); lg.gain.value = 70;
          lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
        } else {
          // A friendly, slightly wrong hum: two detuned sines gliding like a voice.
          dur = 1.4;
          envelope(dur, 0.45);
          osc("sine", 190, 230, dur, out);
          osc("sine", 197, 236, dur, out);
        }
        break;
      }
      case "WRETCH": {
        // Raspy scream.
        dur = alert ? 1.0 : 1.5;
        envelope(dur, alert ? 0.85 : 0.5);
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 2; bp.connect(out);
        const o = osc("sawtooth", alert ? 420 : 260, alert ? 200 : 150, dur, bp);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 14;
        const lg = ctx.createGain(); lg.gain.value = 35;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
        noiseBurst(dur, "highpass", 2500, 0.7, 0.25);
        break;
      }
      case "ECO": {
        // A short blip that echoes itself — a handful of fading repeats.
        const reps = alert ? 4 : 2;
        dur = reps * 0.14 + 0.15;
        out.gain.setValueAtTime(vol * (alert ? 0.6 : 0.3), t);
        for (let i = 0; i < reps; i++) {
          noiseBurst(0.06, "bandpass", alert ? 1200 : 700, 6, (alert ? 0.6 : 0.3) * Math.pow(0.55, i), t + i * 0.14);
        }
        if (alert) osc("square", 480, 240, dur, out);
        break;
      }
      case "OBSERVADOR": {
        if (alert) {
          // Every eye snaps open at once: a fast rising whine.
          dur = 0.8;
          envelope(dur, 0.85);
          osc("sawtooth", 300, 900, dur, out);
          noiseBurst(dur, "highpass", 3000, 1, 0.3);
        } else {
          // Barely-there — something watching, not moving.
          dur = 1.6;
          envelope(dur, 0.3);
          osc("sine", 60, 58, dur, out);
          osc("sine", 90.5, 89, dur, out); // detuned second layer: an unsettling slow beat
        }
        break;
      }
      case "IMITADOR": {
        if (alert) {
          // The disguise drops all at once: a short, harsh glitch-shriek.
          dur = 0.5;
          envelope(dur, 0.95);
          const shaper = ctx.createWaveShaper();
          const curve = new Float32Array(256);
          for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 6); }
          shaper.curve = curve; shaper.connect(out);
          osc("sawtooth", 700, 150, dur, shaper);
          noiseBurst(dur, "highpass", 4000, 0.8, 0.4);
        } else {
          // Convincingly normal — almost a voice, if you don't listen too closely.
          dur = 1.3;
          envelope(dur, 0.35);
          osc("sine", 170, 175, dur, out);
          osc("sine", 172.3, 177, dur, out);
        }
        break;
      }
      case "SOMBRA": {
        dur = alert ? 1.1 : 1.8;
        envelope(dur, alert ? 0.75 : 0.3);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = alert ? 500 : 200; lp.connect(out);
        osc("sine", alert ? 90 : 45, alert ? 60 : 40, dur, lp);
        noiseBurst(dur, "lowpass", alert ? 400 : 150, 0.6, alert ? 0.5 : 0.2);
        break;
      }
      case "VIGIA": {
        // A heavy, infrequent groan — something massive shifting its weight.
        dur = alert ? 1.6 : 2.2;
        envelope(dur, alert ? 0.7 : 0.35);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; lp.connect(out);
        const o = osc("sawtooth", alert ? 55 : 35, alert ? 40 : 30, dur, lp);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 3;
        const lg = ctx.createGain(); lg.gain.value = 6;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
        break;
      }
      case "CEIFADOR": {
        // Abrupt and brief on purpose — "no clear signal" is the point.
        dur = 0.35;
        envelope(dur, alert ? 0.9 : 0.4);
        noiseBurst(dur, "lowpass", alert ? 500 : 300, 1.2, alert ? 0.7 : 0.3);
        osc("sine", alert ? 70 : 50, alert ? 40 : 35, dur, out);
        break;
      }
      default:
        return; // FINGER_KING has its own taps
    }

    this.monsterVoices++;
    setTimeout(() => {
      this.monsterVoices = Math.max(0, this.monsterVoices - 1);
      try { out.disconnect(); panner.disconnect(); } catch { /* already gone */ }
    }, (dur + 0.2) * 1000);
  }

  /** Terminal response: two rising beeps when accepted, a low buzz when refused. */
  /** A box scraping across the carpet: a short, low-passed noise sweep plus a dull thud. */
  public playBoxPush() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const dur = 0.42;

    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.16 * this.settings.volumeSfx, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(lp); lp.connect(ng); ng.connect(this.masterGain);
    noise.start(t);

    const thud = this.ctx.createOscillator();
    thud.type = "triangle";
    thud.frequency.setValueAtTime(70, t + dur - 0.1);
    thud.frequency.exponentialRampToValueAtTime(30, t + dur + 0.08);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.setValueAtTime(0.22 * this.settings.volumeSfx, t + dur - 0.1);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.1);
    thud.connect(tg); tg.connect(this.masterGain);
    thud.start(t + dur - 0.1);
    thud.stop(t + dur + 0.12);
  }

  public playTerminalBeep(accepted: boolean) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const notes = accepted ? [[880, 0, 0.09], [1320, 0.12, 0.14]] : [[160, 0, 0.4]];
    for (const [freq, start, dur] of notes) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t + start);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.05 * this.settings.volumeSfx, t + start);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + start + dur);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + start);
      osc.stop(t + start + dur + 0.02);
    }
  }

  /**
   * Level G's final alarm: a two-tone klaxon replaces the fluorescent hum,
   * which drops almost to nothing. Runs until stopAlarm() or destroy().
   */
  public startAlarm() {
    if (!this.ctx || !this.masterGain || this.alarmOscillators.length > 0) return;
    const t = this.ctx.currentTime;

    const siren = this.ctx.createOscillator();
    siren.type = "sawtooth";
    siren.frequency.setValueAtTime(610, t);
    // A square LFO flips the pitch between two tones
    const lfo = this.ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.setValueAtTime(1.1, t);
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.setValueAtTime(110, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(siren.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1600, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.05 * this.settings.volumeSfx, t + 0.4);

    siren.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    siren.start(t);
    lfo.start(t);
    this.alarmOscillators = [siren, lfo];

    if (this.humGain) this.humGain.gain.linearRampToValueAtTime(this.settings.volumeHum * 0.015, t + 0.6);
  }

  public stopAlarm() {
    this.alarmOscillators.forEach((osc) => {
      try { osc.stop(); osc.disconnect(); } catch (e) {}
    });
    this.alarmOscillators = [];
  }

  // ---------------------------------------------------------------------
  // Level FUN — a music box that never quite plays in tune, and the small
  // noises of a party venue with nobody in it.
  // ---------------------------------------------------------------------
  private funMusic: { gain: GainNode; timer: ReturnType<typeof setTimeout> | null; nodes: OscillatorNode[]; stopped: boolean } | null = null;

  /** Notes are [MIDI, beats]; a MIDI of 0 is a rest. */
  private static readonly FUN_TUNES: Record<"party" | "birthday", [number, number][]> = {
    birthday: [
      [67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2],
      [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
      [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 1],
      [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 2],
    ],
    party: [
      [72, 0.5], [76, 0.5], [79, 0.5], [76, 0.5], [72, 0.5], [76, 0.5], [79, 1],
      [77, 0.5], [74, 0.5], [77, 0.5], [81, 0.5], [79, 0.5], [76, 0.5], [72, 1],
      [74, 0.5], [77, 0.5], [79, 0.5], [77, 0.5], [74, 0.5], [71, 0.5], [67, 1],
      [72, 0.5], [76, 0.5], [79, 0.5], [84, 0.5], [79, 1], [72, 1],
    ],
  };

  /**
   * Starts a music-box tune (looping by default). `distortion` (0..1) slows the
   * tempo, drags notes out of tune and adds a second, wrong voice.
   */
  public startFunMusic(tune: "party" | "birthday", opts: { volume?: number; distortion?: number; loop?: boolean } = {}) {
    if (!this.ctx || !this.masterGain) return;
    this.stopFunMusic(true);
    const ctx = this.ctx;
    const volume = (opts.volume ?? 0.6) * this.settings.volumeSfx * 0.22;
    const distortion = Math.min(1, Math.max(0, opts.distortion ?? 0));
    const loop = opts.loop ?? true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800 - distortion * 2200;
    gain.connect(lp);
    lp.connect(this.masterGain);
    if (this.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = 0.35;
      lp.connect(send);
      send.connect(this.reverbIn);
    }
    const state = { gain, timer: null as ReturnType<typeof setTimeout> | null, nodes: [] as OscillatorNode[], stopped: false };
    this.funMusic = state;
    const notes = AudioManager.FUN_TUNES[tune];

    const bell = (freq: number, at: number, dur: number, amp: number) => {
      for (const [mult, a, type] of [[1, 1, "sine"], [2, 0.32, "sine"], [3.01, 0.12, "triangle"]] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq * mult, at);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(amp * a, at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(g);
        g.connect(gain);
        osc.start(at);
        osc.stop(at + dur + 0.05);
        state.nodes.push(osc);
        osc.onended = () => { const i = state.nodes.indexOf(osc); if (i >= 0) state.nodes.splice(i, 1); };
      }
    };

    const round = (start: number) => {
      if (state.stopped) return;
      let at = start;
      const beat = 0.4 + distortion * 0.12;
      notes.forEach(([midi, beats], i) => {
        const dur = beats * beat * (1 + distortion * (i / notes.length) * 0.5);
        if (midi > 0) {
          const drift = (Math.random() - 0.5) * distortion * 90 + distortion * (i / notes.length) * -60;
          const freq = 440 * Math.pow(2, (midi - 69 + drift / 100) / 12);
          bell(freq, at, Math.max(0.5, dur * 1.8), 0.5);
          if (distortion > 0.45) bell(freq * Math.pow(2, 1 / 12), at + 0.02, Math.max(0.4, dur * 1.4), 0.18 * distortion);
        }
        at += dur;
      });
      if (loop) {
        state.timer = setTimeout(() => round(ctx.currentTime + 0.6 + distortion * 1.2), (at - ctx.currentTime) * 1000);
      }
    };
    round(ctx.currentTime + 0.1);
  }

  /** Fades the music box out, or cuts it dead in the middle of a note. */
  public stopFunMusic(abrupt = false) {
    const m = this.funMusic;
    if (!m || !this.ctx) { this.funMusic = null; return; }
    m.stopped = true;
    if (m.timer) clearTimeout(m.timer);
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0.0001, t + (abrupt ? 0.02 : 1.8));
    const nodes = [...m.nodes];
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }), abrupt ? 60 : 2000);
    this.funMusic = null;
  }

  public get funMusicPlaying(): boolean { return this.funMusic !== null; }

  /** Short procedural sounds for the party level. `pan` is -1..1, `volume` 0..1 (already attenuated by distance). */
  public playFunSound(kind: "slam" | "giggle" | "steps" | "pop" | "creak" | "sting", pan = 0, volume = 1) {
    if (!this.ctx || !this.masterGain) return;
    if (kind === "sting") { this.playKingStinger(); return; }
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume)) * this.settings.volumeSfx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.masterGain);
    if (this.reverbIn) { const send = ctx.createGain(); send.gain.value = 0.45; out.connect(send); send.connect(this.reverbIn); }
    const noise = (dur: number, type: BiquadFilterType, freq: number, q: number, amp: number, at: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, at);
      g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(at, Math.random());
      src.stop(at + dur + 0.02);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, amp: number, at: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(amp, at + Math.min(0.03, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
      osc.connect(g); g.connect(out);
      osc.start(at); osc.stop(at + dur + 0.02);
    };
    switch (kind) {
      case "slam":
        noise(0.35, "lowpass", 500, 0.8, 1.0, t);
        tone("sine", 95, 38, 0.5, 0.9, t);
        noise(0.9, "bandpass", 300, 1.5, 0.25, t + 0.05);
        break;
      case "giggle":
        for (let i = 0; i < 4; i++) tone("sine", 700 + Math.random() * 300, 900 + Math.random() * 400, 0.11, 0.35, t + i * 0.15);
        tone("triangle", 1300, 1700, 0.5, 0.05, t);
        break;
      case "steps":
        for (let i = 0; i < 5; i++) noise(0.09, "bandpass", 520 + (i % 2) * 90, 2, 0.6, t + i * (0.3 + Math.random() * 0.06));
        break;
      case "pop":
        noise(0.12, "highpass", 1800, 0.7, 1.0, t);
        tone("sine", 220, 90, 0.08, 0.5, t);
        break;
      case "creak":
        tone("sawtooth", 84, 138, 0.9, 0.16, t);
        noise(0.9, "bandpass", 900, 6, 0.06, t);
        break;
    }
    setTimeout(() => { try { out.disconnect(); panner.disconnect(); } catch { /* gone */ } }, 3500);
  }

  /**
   * Destroys the audio engine.
   */
  public destroy() {
    try {
      this.stopFunMusic(true);
      this.stopAlarm();
      this.stopDistantAmbianceScheduler();
      this.stopBackgroundMusic();
      this.stopFluorescentHum();
      if (this.ctx) {
        this.ctx.close();
      }
    } catch (e) {
      // Ignored
    }
    this.initialized = false;
  }
}

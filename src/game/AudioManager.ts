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
  private settings: GameSettings;
  private initialized = false;
  public level = 0;

  // Dynamic background procedural music system
  private musicGain: GainNode | null = null;
  private isMusicPlaying = false;
  private currentSanity = 1.0;
  private activeMusicOscillators: OscillatorNode[] = [];

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

      // Start the oppressive background fluorescent hum
      this.startFluorescentHum();
      this.startDistantAmbianceScheduler();
      this.startBackgroundMusic();

      this.initialized = true;
      console.log("Web Audio API Initialized Successfully");
    } catch (e) {
      console.error("Failed to initialize audio:", e);
    }
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
  public playFootstep(speed: 'walk' | 'run' | 'crouch', pan = 0.0, isWet = false) {
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

    osc.start(t);
    osc.stop(t + 0.08);
  }

  /**
   * Periodic scheduler that generates haunting, sparse distant mechanical echoes and pipeline thuds.
   */
  private startDistantAmbianceScheduler() {
    const playAmbiance = () => {
      if (!this.ctx || !this.initialized) return;

      // Random wait interval between 15 and 35 seconds
      const nextDelaySec = 15 + Math.random() * 20;

      setTimeout(() => {
        if (this.ctx && this.masterGain) {
          this.triggerDistantEchoSound();
        }
        playAmbiance();
      }, nextDelaySec * 1000);
    };

    playAmbiance();
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

    // Create a music-specific gain node
    this.musicGain = this.ctx.createGain();
    // Default music volume is slightly quieter than hum to make it a perfect background texture
    const initialMusicVolume = this.settings.volumeHum * 0.15;
    this.musicGain.gain.setValueAtTime(initialMusicVolume, this.ctx.currentTime);
    this.musicGain.connect(this.masterGain);

    const playNextChord = () => {
      if (!this.initialized || !this.ctx || !this.isMusicPlaying) return;

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

  /**
   * Destroys the audio engine.
   */
  public destroy() {
    try {
      this.isMusicPlaying = false;
      this.activeMusicOscillators.forEach(osc => {
        try {
          osc.stop();
          osc.disconnect();
        } catch (e) {}
      });
      this.activeMusicOscillators = [];
      if (this.humOsc1) { this.humOsc1.stop(); this.humOsc1.disconnect(); }
      if (this.humOsc2) { this.humOsc2.stop(); this.humOsc2.disconnect(); }
      if (this.ctx) {
        this.ctx.close();
      }
    } catch (e) {
      // Ignored
    }
    this.initialized = false;
  }
}

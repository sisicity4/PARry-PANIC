import aubio from "aubiojs/build/aubio.esm.js";
import Meyda from "meyda";
import { TRACK_DEFAULT_BPM } from "../config";
import { EventDispatcher } from "../core/EventDispatcher";
import type { AudioEvents, AudioFeatureTick, AudioSnapshot, MicState } from "./types";

const BUFFER_SIZE = 1024;
const HOP_SIZE = 1024;
const LOW_BASS_HZ = 220;

const SHOUT_THRESHOLD = 0.07;
const SHOUT_HOLD_MS = 120;
const SHOUT_COOLDOWN_MS = 850;

interface TempoLike {
  do(buffer: Float32Array): number;
  getBpm(): number;
}

interface RangeTracker {
  min: number;
  max: number;
}

interface TrackFeaturePayload {
  spectralCentroid?: number;
  powerSpectrum?: Float32Array;
  rms?: number;
  buffer?: number[] | Float32Array;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export class AudioEngine {
  private dispatcher = new EventDispatcher<AudioEvents>();

  private audioContext: AudioContext | null = null;
  private trackSource: AudioBufferSourceNode | null = null;
  private trackAnalyzer: { start: () => void; stop: () => void } | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyzer: { start: () => void; stop: () => void } | null = null;
  private masterGain: GainNode | null = null;

  private tempoDetector: TempoLike | null = null;
  private aubioLoadStarted = false;

  private trackBuffer: AudioBuffer | null = null;
  private trackStartTime = 0;
  private running = false;

  private bpm = TRACK_DEFAULT_BPM;
  private beatCount = -1;
  private subdivisionCount = -1;
  private nextBeatSec = 0;
  private nextSubdivisionSec = 0;

  private centroidRange: RangeTracker = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  private bassRange: RangeTracker = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };

  private frameAccumulator = {
    centroidRaw: 0,
    bassRaw: 0,
    rms: 0,
    count: 0,
  };

  private latestNormalized = {
    centroid: 0.5,
    bass: 0.5,
    rms: 0,
  };

  private shoutGateOpen = false;
  private shoutHoldStartedAtMs = 0;
  private lastShoutAtMs = 0;
  private micState: MicState = "idle";

  private lastSnapshot: AudioSnapshot = {
    bpm: TRACK_DEFAULT_BPM,
    bpmNorm: this.normalizeBpm(TRACK_DEFAULT_BPM),
    spectralCentroid: 0.5,
    bassEnergy: 0.5,
    rms: 0,
    beatCount: 0,
    subdivisionCount: 0,
    trackTimeSec: 0,
    micState: "idle",
    shoutGateOpen: false,
  };

  on = this.dispatcher.on.bind(this.dispatcher);

  async start(): Promise<void> {
    await this.ensureAudioContext();
    if (!this.audioContext) {
      return;
    }

    await this.loadTempoDetector(this.audioContext.sampleRate);

    if (!this.trackBuffer) {
      this.trackBuffer = this.createDemoTrackBuffer(this.audioContext, this.audioContext.sampleRate, TRACK_DEFAULT_BPM);
    }

    this.stopTrackOnly();

    this.trackSource = this.audioContext.createBufferSource();
    this.trackSource.buffer = this.trackBuffer;
    this.trackSource.loop = true;

    if (!this.masterGain) {
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.audioContext.destination);
    }

    this.trackSource.connect(this.masterGain);

    this.trackAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext: this.audioContext,
      source: this.trackSource,
      bufferSize: BUFFER_SIZE,
      featureExtractors: ["spectralCentroid", "powerSpectrum", "rms", "buffer"],
      callback: (features: TrackFeaturePayload) => {
        this.handleTrackFeatures(features);
      },
    }) as { start: () => void; stop: () => void };

    this.trackAnalyzer.start();

    this.trackStartTime = this.audioContext.currentTime;
    this.running = true;
    this.bpm = TRACK_DEFAULT_BPM;
    this.beatCount = -1;
    this.subdivisionCount = -1;
    this.nextBeatSec = 0;
    this.nextSubdivisionSec = 0;
    this.frameAccumulator.count = 0;

    this.trackSource.start();
  }

  stop(): void {
    this.stopTrackOnly();

    this.running = false;
    this.shoutGateOpen = false;
    this.shoutHoldStartedAtMs = 0;
  }

  update(): void {
    if (!this.running) {
      return;
    }

    const trackTimeSec = this.getTrackTimeSeconds();

    while (trackTimeSec >= this.nextBeatSec) {
      this.beatCount += 1;
      this.dispatcher.emit("beat", {
        beatCount: this.beatCount,
        trackTimeSec: this.nextBeatSec,
        bpm: this.bpm,
      });
      this.nextBeatSec += this.getBeatDurationSeconds();
    }

    while (trackTimeSec >= this.nextSubdivisionSec) {
      this.subdivisionCount += 1;
      const snapshot = this.flushFeatureAccumulator();
      this.lastSnapshot = {
        ...this.lastSnapshot,
        ...snapshot,
        beatCount: this.beatCount,
        subdivisionCount: this.subdivisionCount,
        trackTimeSec,
        micState: this.micState,
        shoutGateOpen: this.shoutGateOpen,
      };

      this.dispatcher.emit("featureTick", {
        timestampMs: performance.now(),
        trackTimeSec,
        beatCount: this.beatCount,
        subdivisionCount: this.subdivisionCount,
        bpm: this.bpm,
        bpmNorm: this.lastSnapshot.bpmNorm,
        spectralCentroid: this.lastSnapshot.spectralCentroid,
        bassEnergy: this.lastSnapshot.bassEnergy,
        rms: this.lastSnapshot.rms,
      } satisfies AudioFeatureTick);

      this.nextSubdivisionSec += this.getBeatDurationSeconds() / 2;
    }
  }

  setShoutGate(open: boolean): void {
    this.shoutGateOpen = open;
    this.lastSnapshot.shoutGateOpen = open;

    if (open && this.micState !== "ready" && this.micState !== "requesting") {
      void this.ensureMicrophone();
    }

    if (!open) {
      this.shoutHoldStartedAtMs = 0;
    }
  }

  getSnapshot(): AudioSnapshot {
    return {
      ...this.lastSnapshot,
      trackTimeSec: this.getTrackTimeSeconds(),
      beatCount: Math.max(0, this.beatCount),
      subdivisionCount: Math.max(0, this.subdivisionCount),
      micState: this.micState,
      shoutGateOpen: this.shoutGateOpen,
    };
  }

  getTrackTimeSeconds(): number {
    if (!this.audioContext || !this.running) {
      return 0;
    }
    return Math.max(0, this.audioContext.currentTime - this.trackStartTime);
  }

  getBeatDurationSeconds(): number {
    return 60 / Math.max(1, this.bpm);
  }

  getBeatProgress01(): number {
    const beatDuration = this.getBeatDurationSeconds();
    if (!Number.isFinite(beatDuration) || beatDuration <= 0) {
      return 0;
    }

    const phase = this.getTrackTimeSeconds() % beatDuration;
    return clamp01(phase / beatDuration);
  }

  getDistanceToNearestBeatSec(trackTimeSec = this.getTrackTimeSeconds()): number {
    const beatDuration = this.getBeatDurationSeconds();
    if (beatDuration <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    const phase = trackTimeSec % beatDuration;
    return Math.min(phase, beatDuration - phase);
  }

  private async ensureAudioContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }
  }

  private async loadTempoDetector(sampleRate: number): Promise<void> {
    if (this.tempoDetector || this.aubioLoadStarted) {
      return;
    }

    this.aubioLoadStarted = true;
    try {
      const aubioModule = await aubio();
      this.tempoDetector = new aubioModule.Tempo(BUFFER_SIZE, HOP_SIZE, sampleRate);
    } catch (_error) {
      this.tempoDetector = null;
    }
  }

  private stopTrackOnly(): void {
    this.trackAnalyzer?.stop();
    this.trackAnalyzer = null;

    if (this.trackSource) {
      try {
        this.trackSource.stop();
      } catch (_error) {
        // The source is already stopped.
      }
      this.trackSource.disconnect();
      this.trackSource = null;
    }
  }

  private async ensureMicrophone(): Promise<void> {
    if (this.micState === "denied" || this.micState === "ready" || this.micState === "requesting") {
      return;
    }

    await this.ensureAudioContext();
    if (!this.audioContext) {
      return;
    }

    this.updateMicState("requesting");

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.micSource = this.audioContext.createMediaStreamSource(mediaStream);
      this.micAnalyzer = Meyda.createMeydaAnalyzer({
        audioContext: this.audioContext,
        source: this.micSource,
        bufferSize: BUFFER_SIZE,
        featureExtractors: ["rms"],
        callback: (features: { rms?: number }) => {
          this.handleMicFeatures(features.rms ?? 0);
        },
      }) as { start: () => void; stop: () => void };

      this.micAnalyzer.start();
      this.updateMicState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown microphone error";
      this.updateMicState("denied", message);
    }
  }

  private updateMicState(state: MicState, reason?: string): void {
    this.micState = state;
    this.lastSnapshot.micState = state;
    this.dispatcher.emit("micState", { state, reason });
  }

  private handleMicFeatures(rms: number): void {
    const now = performance.now();
    this.lastSnapshot.rms = Math.max(0, rms);

    if (!this.shoutGateOpen) {
      this.shoutHoldStartedAtMs = 0;
      return;
    }

    if (rms < SHOUT_THRESHOLD) {
      this.shoutHoldStartedAtMs = 0;
      return;
    }

    if (this.shoutHoldStartedAtMs === 0) {
      this.shoutHoldStartedAtMs = now;
      return;
    }

    const holdMs = now - this.shoutHoldStartedAtMs;
    if (holdMs < SHOUT_HOLD_MS) {
      return;
    }

    if (now - this.lastShoutAtMs < SHOUT_COOLDOWN_MS) {
      return;
    }

    this.lastShoutAtMs = now;
    this.dispatcher.emit("shout", {
      timestampMs: now,
      rms,
      holdMs,
    });
  }

  private handleTrackFeatures(features: TrackFeaturePayload): void {
    const centroidRaw = features.spectralCentroid ?? 0;
    const bassRaw = this.computeBassEnergy(features.powerSpectrum, this.audioContext?.sampleRate ?? 48000);
    const rms = features.rms ?? 0;

    this.updateRange(this.centroidRange, centroidRaw);
    this.updateRange(this.bassRange, bassRaw);

    this.latestNormalized.centroid = this.normalizeUsingRange(centroidRaw, this.centroidRange);
    this.latestNormalized.bass = this.normalizeUsingRange(bassRaw, this.bassRange);
    this.latestNormalized.rms = Math.max(0, rms);

    if (this.tempoDetector && features.buffer) {
      const input =
        features.buffer instanceof Float32Array ? features.buffer : Float32Array.from(features.buffer);
      this.tempoDetector.do(input);
      const detectedBpm = this.tempoDetector.getBpm();
      if (Number.isFinite(detectedBpm) && detectedBpm >= 60 && detectedBpm <= 210) {
        this.bpm = lerp(this.bpm, detectedBpm, 0.08);
      }
    }

    this.frameAccumulator.centroidRaw += this.latestNormalized.centroid;
    this.frameAccumulator.bassRaw += this.latestNormalized.bass;
    this.frameAccumulator.rms += this.latestNormalized.rms;
    this.frameAccumulator.count += 1;
  }

  private flushFeatureAccumulator(): Pick<AudioSnapshot, "bpm" | "bpmNorm" | "spectralCentroid" | "bassEnergy" | "rms"> {
    let centroid = this.latestNormalized.centroid;
    let bass = this.latestNormalized.bass;
    let rms = this.latestNormalized.rms;

    if (this.frameAccumulator.count > 0) {
      const invCount = 1 / this.frameAccumulator.count;
      centroid = this.frameAccumulator.centroidRaw * invCount;
      bass = this.frameAccumulator.bassRaw * invCount;
      rms = this.frameAccumulator.rms * invCount;
    }

    this.frameAccumulator.centroidRaw = 0;
    this.frameAccumulator.bassRaw = 0;
    this.frameAccumulator.rms = 0;
    this.frameAccumulator.count = 0;

    const bpmNorm = this.normalizeBpm(this.bpm);

    return {
      bpm: this.bpm,
      bpmNorm,
      spectralCentroid: clamp01(centroid),
      bassEnergy: clamp01(bass),
      rms: Math.max(0, rms),
    };
  }

  private normalizeBpm(value: number): number {
    return clamp01((value - 80) / (185 - 80));
  }

  private computeBassEnergy(powerSpectrum: Float32Array | undefined, sampleRate: number): number {
    if (!powerSpectrum || powerSpectrum.length === 0) {
      return 0;
    }

    const nyquist = sampleRate / 2;
    const binWidth = nyquist / powerSpectrum.length;
    const maxIndex = Math.min(powerSpectrum.length - 1, Math.floor(LOW_BASS_HZ / Math.max(1, binWidth)));

    let sum = 0;
    let bins = 0;
    for (let index = 0; index <= maxIndex; index += 1) {
      sum += powerSpectrum[index];
      bins += 1;
    }

    if (bins === 0) {
      return 0;
    }

    return sum / bins;
  }

  private updateRange(range: RangeTracker, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
  }

  private normalizeUsingRange(value: number, range: RangeTracker): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    const span = range.max - range.min;
    if (!Number.isFinite(span) || span <= 1e-6) {
      return 0.5;
    }

    return clamp01((value - range.min) / span);
  }

  private createDemoTrackBuffer(context: AudioContext, sampleRate: number, bpm: number): AudioBuffer {
    const seconds = 96;
    const frameCount = Math.floor(sampleRate * seconds);
    const buffer = context.createBuffer(2, frameCount, sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);

      for (let index = 0; index < frameCount; index += 1) {
        const t = index / sampleRate;
        const beatPhase = ((t * bpm) / 60) % 1;
        const bar = Math.floor((t * bpm) / (60 * 4));
        const section = Math.floor(bar / 16) % 3;

        const sectionBass = section === 0 ? 0.7 : section === 1 ? 1.0 : 1.2;
        const sectionBrightness = section === 2 ? 1.3 : 1.0;

        const kickEnvelope = Math.exp(-beatPhase * 20);
        const kick = Math.sin(2 * Math.PI * (48 + beatPhase * 40) * t) * kickEnvelope * 0.6 * sectionBass;

        const subBeatPhase = ((t * bpm) / 30) % 1;
        const snareEnvelope = Math.exp(-subBeatPhase * 35);
        const snare = (Math.random() * 2 - 1) * snareEnvelope * 0.08;

        const bass = Math.sin(2 * Math.PI * 55 * t) * 0.18 * sectionBass;
        const sawLike =
          (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 440 * t) * 0.5) *
          0.06 *
          sectionBrightness;

        data[index] = (kick + snare + bass + sawLike) * 0.9;
      }
    }

    return buffer;
  }
}

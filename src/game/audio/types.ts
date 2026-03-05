export interface AudioFeatureTick {
  timestampMs: number;
  trackTimeSec: number;
  beatCount: number;
  subdivisionCount: number;
  bpm: number;
  bpmNorm: number;
  spectralCentroid: number;
  bassEnergy: number;
  rms: number;
}

export interface BeatEvent {
  beatCount: number;
  trackTimeSec: number;
  bpm: number;
}

export interface ShoutEvent {
  timestampMs: number;
  rms: number;
  holdMs: number;
}

export type MicState = "idle" | "requesting" | "ready" | "denied";

export interface MicStateEvent {
  state: MicState;
  reason?: string;
}

export interface AudioSnapshot {
  bpm: number;
  bpmNorm: number;
  spectralCentroid: number;
  bassEnergy: number;
  rms: number;
  beatCount: number;
  subdivisionCount: number;
  trackTimeSec: number;
  micState: MicState;
  shoutGateOpen: boolean;
}

export interface AudioEvents {
  beat: BeatEvent;
  featureTick: AudioFeatureTick;
  shout: ShoutEvent;
  micState: MicStateEvent;
}

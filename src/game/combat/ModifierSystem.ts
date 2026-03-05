import type { ActiveModifier, ModifierType } from "./types";

const PRIORITY_ORDER: ModifierType[] = [
  "TimeStretch",
  "BeatShield",
  "KnockbackNull",
  "LightFlickerBoost",
];

export class ModifierSystem {
  private active = new Map<ModifierType, ActiveModifier>();

  apply(type: ModifierType, beats: number): void {
    this.active.set(type, {
      type,
      remainingBeats: Math.max(1, Math.floor(beats)),
    });
  }

  onBeat(): void {
    for (const [type, modifier] of this.active) {
      modifier.remainingBeats -= 1;
      if (modifier.remainingBeats <= 0) {
        this.active.delete(type);
      }
    }
  }

  has(type: ModifierType): boolean {
    return this.active.has(type);
  }

  clear(): void {
    this.active.clear();
  }

  getTimeScale(): number {
    return this.has("TimeStretch") ? 0.6 : 1;
  }

  listActive(): ActiveModifier[] {
    return [...this.active.values()].sort((a, b) => {
      return PRIORITY_ORDER.indexOf(a.type) - PRIORITY_ORDER.indexOf(b.type);
    });
  }
}

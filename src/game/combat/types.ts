export const MODIFIER_TYPES = [
  "TimeStretch",
  "BeatShield",
  "KnockbackNull",
  "LightFlickerBoost",
] as const;

export type ModifierType = (typeof MODIFIER_TYPES)[number];

export interface ActiveModifier {
  type: ModifierType;
  remainingBeats: number;
}

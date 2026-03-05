import { AudioEngine } from "../audio/AudioEngine";
import { MetaProgression } from "../persistence/MetaProgression";

export const runtime = {
  audio: new AudioEngine(),
  meta: new MetaProgression(),
};

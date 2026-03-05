const STORAGE_KEY = "loud-dungeon.meta.v1";

export interface MetaSave {
  version: 1;
  totalRuns: number;
  totalPoints: number;
  unlockedWeapons: string[];
  modifierSlots: number;
  staminaLevel: number;
}

const DEFAULT_META: MetaSave = {
  version: 1,
  totalRuns: 0,
  totalPoints: 0,
  unlockedWeapons: ["Dagger"],
  modifierSlots: 1,
  staminaLevel: 0,
};

export class MetaProgression {
  private saveData: MetaSave;

  constructor() {
    this.saveData = this.load();
  }

  get snapshot(): MetaSave {
    return structuredClone(this.saveData);
  }

  commitRun(points: number): MetaSave {
    this.saveData.totalRuns += 1;
    this.saveData.totalPoints += Math.max(0, Math.floor(points));

    if (this.saveData.totalPoints >= 120 && !this.saveData.unlockedWeapons.includes("MicStand")) {
      this.saveData.unlockedWeapons.push("MicStand");
    }
    if (this.saveData.totalPoints >= 240 && !this.saveData.unlockedWeapons.includes("AmpWave")) {
      this.saveData.unlockedWeapons.push("AmpWave");
    }
    if (this.saveData.totalPoints >= 180) {
      this.saveData.modifierSlots = 2;
    }
    if (this.saveData.totalPoints >= 300) {
      this.saveData.staminaLevel = 1;
    }

    this.persist();
    return this.snapshot;
  }

  private load(): MetaSave {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_META);
    }

    try {
      const parsed = JSON.parse(raw) as Partial<MetaSave>;
      if (parsed.version !== 1) {
        throw new Error("Unsupported meta version");
      }

      return {
        ...DEFAULT_META,
        ...parsed,
        unlockedWeapons: Array.isArray(parsed.unlockedWeapons)
          ? parsed.unlockedWeapons.filter((value): value is string => typeof value === "string")
          : [...DEFAULT_META.unlockedWeapons],
      };
    } catch (_error) {
      localStorage.setItem(`${STORAGE_KEY}.backup.${Date.now()}`, raw);
      return structuredClone(DEFAULT_META);
    }
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saveData));
  }
}

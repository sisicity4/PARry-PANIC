export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.float(min, maxInclusive + 1));
  }

  pickWeighted<T>(entries: Array<{ item: T; weight: number }>): T {
    const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (totalWeight <= 0) {
      return entries[0].item;
    }

    let cursor = this.next() * totalWeight;
    for (const entry of entries) {
      cursor -= Math.max(0, entry.weight);
      if (cursor <= 0) {
        return entry.item;
      }
    }

    return entries[entries.length - 1].item;
  }
}

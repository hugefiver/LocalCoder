export class MemoryLegacyStorage implements Storage {
  private readonly values = new Map<string, string>();

  constructor(entries: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  entries(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.values.entries());
  }
}

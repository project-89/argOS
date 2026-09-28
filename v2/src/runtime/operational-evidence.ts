/** Bounded hot evidence, never an authoritative delivery queue or character memory. */
export interface EvidenceLimits { maxEntries: number; maxBytes: number }
export interface EvidenceCoverage {
  total: number;
  retained: number;
  /** Conservative payload estimate at insertion, not V8 heap accounting. */
  retainedEstimatedBytes: number;
  evicted: number;
  oversized: number;
  unmeasurable: number;
  consumed: number;
  complete: boolean;
  maxEntries: number;
  maxBytes: number;
}

/** Stop measuring once over budget. Do not call getters/toJSON or stringify a huge
 * body. Unsupported/cyclic objects remain available to archive observers but are
 * not retained in the hot evidence tail. This is not a serialization format. */
export function estimateEvidenceBytes(value: unknown, ceiling: number): number | undefined {
  const active = new Set<object>();
  let bytes = 0, nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 65536 || depth > 128) return false;
    if (typeof item === "string") { bytes += Buffer.byteLength(item, "utf8") * 2 + 16; return true; }
    if (item === null || item === undefined || typeof item === "boolean" || typeof item === "number") { bytes += 16; return true; }
    if (typeof item !== "object" || active.has(item)) return false;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
    active.add(item); bytes += 32;
    for (const key of Object.keys(item)) {
      bytes += Buffer.byteLength(key, "utf8") * 2 + 16;
      if (bytes > ceiling) break;
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !("value" in property) || !visit(property.value, depth + 1)) return false;
      if (bytes > ceiling) break;
    }
    active.delete(item);
    return true;
  };
  try { return visit(value, 0) ? bytes : undefined; } catch { return undefined; }
}

/** Ordinary array facade for legacy append/read/drain consumers. Admission and
 * archive notification happen on insertion, before any capacity eviction. Values
 * preserve their existing identity; callers must not grow retained bodies in
 * place (the byte budget is an insertion-time estimate). */
export class OperationalEvidenceTail<T> {
  readonly values: T[];
  readonly limits: EvidenceLimits;
  private raw: T[] = [];
  private sizes: number[] = [];
  private total = 0;
  private bytes = 0;
  private evicted = 0;
  private oversized = 0;
  private unmeasurable = 0;
  private consumed = 0;

  constructor(limits: EvidenceLimits, private onAppend?: (value: T, sequence: number) => void) {
    for (const limit of Object.values(limits)) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Evidence limits must be finite nonnegative integers");
    }
    this.limits = Object.freeze({ ...limits });
    this.values = new Proxy(this.raw, {
      get: (target, key, receiver) => {
        if (key === "push") return (...items: T[]) => { this.insert(this.raw.length, 0, items); return this.raw.length; };
        if (key === "unshift") return (...items: T[]) => { this.insert(0, 0, items); return this.raw.length; };
        if (key === "pop") return () => this.insert(Math.max(0, this.raw.length - 1), 1, [])[0];
        if (key === "shift") return () => this.insert(0, 1, [])[0];
        if (key === "splice") return (...args: [number, number?, ...T[]]) => {
          const start = args[0] < 0 ? Math.max(0, this.raw.length + args[0]) : Math.min(args[0], this.raw.length);
          return this.insert(start, args.length < 2 ? this.raw.length - start : Math.max(0, args[1] ?? 0), args.slice(2) as T[]);
        };
        return Reflect.get(target, key, receiver);
      },
      set: (_target, key, value) => {
        if (key === "length") {
          if (!Number.isSafeInteger(value) || value < 0 || value > this.raw.length) throw new RangeError("Evidence arrays support shrinking length, not sparse expansion");
          this.insert(value, this.raw.length - value, []); return true;
        }
        if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) {
          const index = Number(key);
          if (index > this.raw.length) throw new RangeError("Evidence arrays do not support sparse insertion");
          this.insert(index, index < this.raw.length ? 1 : 0, [value]); return true;
        }
        return Reflect.set(this.raw, key, value);
      },
    });
  }

  private insert(start: number, count: number, values: T[]): T[] {
    const removed = this.raw.splice(start, count);
    const removedSizes = this.sizes.splice(start, count);
    this.bytes -= removedSizes.reduce((sum, size) => sum + size, 0);
    this.consumed += removed.length;
    const admitted: T[] = [], sizes: number[] = [];
    for (const value of values) {
      const sequence = ++this.total;
      // Owners isolate observer failures, keeping archive status visible.
      this.onAppend?.(value, sequence);
      const size = estimateEvidenceBytes(value, this.limits.maxBytes);
      if (size === undefined) { this.unmeasurable++; continue; }
      if (size > this.limits.maxBytes) { this.oversized++; continue; }
      if (this.limits.maxEntries === 0) { this.evicted++; continue; }
      admitted.push(value); sizes.push(size); this.bytes += size;
    }
    this.raw.splice(start, 0, ...admitted); this.sizes.splice(start, 0, ...sizes);
    while (this.raw.length > this.limits.maxEntries || this.bytes > this.limits.maxBytes) {
      this.raw.shift(); this.bytes -= this.sizes.shift()!; this.evicted++;
    }
    return removed;
  }

  replace(values: T[]): void {
    const copy = [...values];
    this.insert(0, this.raw.length, copy);
  }

  coverage(): EvidenceCoverage {
    return {
      total: this.total, retained: this.raw.length, retainedEstimatedBytes: this.bytes,
      evicted: this.evicted, oversized: this.oversized, unmeasurable: this.unmeasurable, consumed: this.consumed,
      complete: this.total === this.raw.length, ...this.limits,
    };
  }
}

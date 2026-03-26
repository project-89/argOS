/**
 * Fixed-capacity ring buffer with O(1) push and shift.
 * When full, oldest entries are overwritten (and overflow counter increments).
 *
 * Replaces Array-based event buffers where Array.shift() is O(n).
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0; // Next write position
  private tail: number = 0; // Next read position
  private _size: number = 0;
  private _overflows: number = 0;
  private _hasLoggedOverflow: boolean = false;

  constructor(public readonly capacity: number) {
    if (capacity < 1) {
      throw new Error(`RingBuffer capacity must be >= 1, got ${capacity}`);
    }
    this.buffer = new Array<T | undefined>(capacity);
  }

  /** Add an item to the buffer. Overwrites oldest entry if full. */
  push(item: T): void {
    if (this._size === this.capacity) {
      // Overwrite oldest: advance tail past the entry we are about to clobber
      this.tail = (this.tail + 1) % this.capacity;
      this._overflows++;
    } else {
      this._size++;
    }
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }

  /** Remove and return the oldest item, or undefined if empty. */
  shift(): T | undefined {
    if (this._size === 0) return undefined;
    const item = this.buffer[this.tail];
    this.buffer[this.tail] = undefined; // Allow GC
    this.tail = (this.tail + 1) % this.capacity;
    this._size--;
    return item;
  }

  /** Read the oldest item without removing it, or undefined if empty. */
  peek(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buffer[this.tail];
  }

  /** Return all items from oldest to newest as a plain array. */
  toArray(): T[] {
    if (this._size === 0) return [];
    const result: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buffer[(this.tail + i) % this.capacity] as T;
    }
    return result;
  }

  /** Remove all items from the buffer. */
  clear(): void {
    // Allow GC for stored references
    for (let i = 0; i < this.capacity; i++) {
      this.buffer[i] = undefined;
    }
    this.head = 0;
    this.tail = 0;
    this._size = 0;
    // Intentionally do NOT reset _overflows -- it is a cumulative counter
  }

  /** Current number of items in the buffer. */
  get size(): number {
    return this._size;
  }

  /** True when the buffer is at capacity (next push will overwrite). */
  get isFull(): boolean {
    return this._size === this.capacity;
  }

  /** True when the buffer contains no items. */
  get isEmpty(): boolean {
    return this._size === 0;
  }

  /** Cumulative count of items lost to overflow (overwrites). */
  get overflows(): number {
    return this._overflows;
  }

  /**
   * Check and log first overflow. Returns true if this is the first
   * overflow detected (so the caller can emit a warning once).
   */
  checkFirstOverflow(): boolean {
    if (this._overflows > 0 && !this._hasLoggedOverflow) {
      this._hasLoggedOverflow = true;
      return true;
    }
    return false;
  }

  /** Iterate items from oldest to newest. */
  [Symbol.iterator](): Iterator<T> {
    let index = 0;
    const size = this._size;
    const tail = this.tail;
    const capacity = this.capacity;
    const buffer = this.buffer;

    return {
      next(): IteratorResult<T> {
        if (index >= size) {
          return { done: true, value: undefined as any };
        }
        const value = buffer[(tail + index) % capacity] as T;
        index++;
        return { done: false, value };
      },
    };
  }
}

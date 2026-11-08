// Performance building blocks: lazy initialization, a connection pool and a cache. They are generic and take their dependencies as arguments, so
// nothing connects anywhere until someone asks, and a pool only ever holds what its own factory creates. The cache is namespaced by company: one
// company's entry can never be read, invalidated or evicted on behalf of another.

/** Creates a value the first time it is asked for, once, even when many ask at the same moment. A failure is not remembered: the next ask tries again. */
export class Lazy<T> {
  private promise: Promise<T> | null = null;
  private ready = false;
  constructor(private readonly factory: () => Promise<T> | T) {}
  get initialized(): boolean {
    return this.ready;
  }
  get(): Promise<T> {
    if (!this.promise) {
      this.promise = Promise.resolve()
        .then(() => this.factory())
        .then((value) => { this.ready = true; return value; })
        .catch((error: unknown) => { this.promise = null; throw error; });
    }
    return this.promise;
  }
}

// ---------------------------------------------------------------- the pool
export type PoolOptions<T> = {
  create: () => Promise<T> | T;
  destroy?: (item: T) => Promise<void> | void;
  validate?: (item: T) => boolean;
  max?: number;
  acquireTimeoutMs?: number;
};
export type PoolStats = { size: number; idle: number; busy: number; waiting: number; created: number };

/** A pool of reusable connections. Items are created on demand up to `max`; extra requests wait their turn and give up after a limit. */
export class Pool<T> {
  private readonly idle: T[] = [];
  private readonly busy = new Set<T>();
  private readonly waiters: { resolve: (item: T) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private creating = 0;
  private created = 0;
  private closed = false;
  constructor(private readonly options: PoolOptions<T>) {}

  async acquire(): Promise<T> {
    if (this.closed) throw new Error("El pool está cerrado.");
    let item = this.idle.pop();
    while (item !== undefined && this.options.validate && !this.options.validate(item)) {
      await this.options.destroy?.(item);
      item = this.idle.pop();
    }
    if (item !== undefined) { this.busy.add(item); return item; }
    if (this.busy.size + this.creating < (this.options.max ?? 4)) {
      this.creating += 1;
      try {
        const fresh = await this.options.create();
        this.created += 1;
        this.busy.add(fresh);
        return fresh;
      } finally {
        this.creating -= 1;
      }
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("No hubo una conexión libre a tiempo."));
      }, this.options.acquireTimeoutMs ?? 5_000);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  release(item: T): void {
    if (!this.busy.delete(item)) return;
    const waiter = this.waiters.shift();
    if (waiter) { clearTimeout(waiter.timer); this.busy.add(item); waiter.resolve(item); return; }
    if (this.closed) { void this.options.destroy?.(item); return; }
    this.idle.push(item);
  }

  /** Borrows an item for the length of a task and always gives it back. */
  async use<R>(work: (item: T) => Promise<R> | R): Promise<R> {
    const item = await this.acquire();
    try {
      return await work(item);
    } finally {
      this.release(item);
    }
  }

  stats(): PoolStats {
    return { size: this.idle.length + this.busy.size, idle: this.idle.length, busy: this.busy.size, waiting: this.waiters.length, created: this.created };
  }

  /** Closes the pool: waiting requests fail and every idle item is destroyed. */
  async drain(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error("El pool se cerró.")); }
    for (const item of this.idle.splice(0)) await this.options.destroy?.(item);
  }
}

// ---------------------------------------------------------------- the cache
export type CacheStats = { hits: number; misses: number; size: number; evictions: number };

/** A small cache with an expiry and a size limit. Every key carries its company, and one company's entries can be dropped without touching another's. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number; tenantId: string }>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  constructor(private readonly options: { ttlMs: number; maxEntries: number; now?: () => number }) {}

  private key(tenantId: string, key: string): string {
    if (tenantId.trim() === "") throw new Error("La caché exige una empresa.");
    return `${tenantId}\u0000${key}`;
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get(tenantId: string, key: string): V | undefined {
    const id = this.key(tenantId, key);
    const entry = this.entries.get(id);
    if (!entry || entry.expires <= this.now()) {
      if (entry) this.entries.delete(id);
      this.misses += 1;
      return undefined;
    }
    this.entries.delete(id); // most recently used goes to the end
    this.entries.set(id, entry);
    this.hits += 1;
    return entry.value;
  }

  set(tenantId: string, key: string, value: V, ttlMs: number = this.options.ttlMs): void {
    const id = this.key(tenantId, key);
    this.entries.delete(id);
    this.entries.set(id, { value, expires: this.now() + ttlMs, tenantId });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
  }

  invalidate(tenantId: string, key: string): void {
    this.entries.delete(this.key(tenantId, key));
  }

  /** Drops everything of one company, for example after its plan or its permissions change. */
  invalidateTenant(tenantId: string): number {
    let dropped = 0;
    for (const [id, entry] of [...this.entries]) if (entry.tenantId === tenantId) { this.entries.delete(id); dropped += 1; }
    return dropped;
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.entries.size, evictions: this.evictions };
  }
}

// Batched refresh for the at-risk feed. Health comes for every borrower in a few multicalls, then positions
// only for the borrowers that stay in the feed. A failed read keeps that borrower's last good row; only a
// definite answer (repaid, above the ceiling, no debt) drops one.

export type Read<T> = { ok: true; value: T } | { ok: false };

export interface BatchRefreshOptions<H, D, R> {
  borrowers: string[];
  /** One result per borrower, in order. Throws when the whole call fails. */
  readHealth: (batch: string[]) => Promise<Array<Read<H>>>;
  /** Same, for the borrowers that passed `inBand`. */
  readPositions: (batch: string[]) => Promise<Array<Read<D>>>;
  /** False when the borrower no longer belongs in the feed (repaid, HF above the ceiling). */
  inBand: (health: H) => boolean;
  /** Null when the borrower has no debt left. */
  toRow: (borrower: string, health: H, positions: D) => R | null;
  /** Last good row per borrower; updated in place. */
  lastGood: Map<string, R>;
  batchSize?: number;
  retries?: number;
  retryDelayMs?: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function refreshRowsBatched<H, D, R>(o: BatchRefreshOptions<H, D, R>): Promise<{ rows: R[]; failed: number }> {
  const { borrowers, readHealth, readPositions, inBand, toRow, lastGood, batchSize = 20, retries = 3, retryDelayMs = 250 } = o;
  const rows: R[] = [];
  let failed = 0;

  const keep = (b: string) => {
    failed++;
    const kept = lastGood.get(b);
    if (kept) rows.push(kept);
  };
  // A whole-call failure is retried; if it keeps failing the batch is split in half (a size limit may be
  // the cause), and a single borrower that still fails keeps its last good row (a failed read).
  const call = async <T>(batch: string[], fn: (b: string[]) => Promise<Array<Read<T>>>): Promise<Array<Read<T>>> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn(batch);
      } catch (e) {
        if (attempt >= retries) {
          console.warn(`[at-risk] batch of ${batch.length} failed after ${attempt} tries: ${(e as Error)?.message ?? e}`);
          if (batch.length <= 1) return batch.map(() => ({ ok: false }));
          const mid = Math.ceil(batch.length / 2);
          return [...(await call(batch.slice(0, mid), fn)), ...(await call(batch.slice(mid), fn))];
        }
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
    }
  };

  const healths = new Map<string, H>();
  const inFeed: string[] = [];
  for (const batch of chunk(borrowers, batchSize)) {
    const res = await call(batch, readHealth);
    batch.forEach((b, i) => {
      const r = res[i];
      if (!r?.ok) return keep(b);
      if (!inBand(r.value)) return void lastGood.delete(b);
      healths.set(b, r.value);
      inFeed.push(b);
    });
  }
  for (const batch of chunk(inFeed, batchSize)) {
    const res = await call(batch, readPositions);
    batch.forEach((b, i) => {
      const r = res[i];
      if (!r?.ok) return keep(b);
      const row = toRow(b, healths.get(b) as H, r.value);
      if (row) {
        lastGood.set(b, row);
        rows.push(row);
      } else lastGood.delete(b);
    });
  }
  return { rows, failed };
}

/** Inclusive [from, to] windows of at most `size` blocks (the Hadrian proxy refuses getLogs ranges over 1,000,000 blocks). */
export function blockWindows(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let s = from; s <= to; s += size) out.push([s, s + size - 1n > to ? to : s + size - 1n]);
  return out;
}

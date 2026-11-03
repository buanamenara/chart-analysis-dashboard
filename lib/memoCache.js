// Cache in-memory singkat (gratis, tanpa KV). Di Cloudflare, memori modul bertahan
// selama isolate Worker hidup, jadi request beruntun ke instance yang sama memakai
// hasil yang sama alih-alih memanggil Yahoo/Binance lagi. Request yang sedang
// berjalan juga dibagi (dedup). Hasil gagal tidak disimpan.
const MAX_ENTRIES = 200;

export function createMemoCache() {
  const store = new Map();
  return function memo(key, ttlMs, fn) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.t < ttlMs) return hit.p;

    const p = Promise.resolve().then(fn);
    store.set(key, { p, t: now });
    p.catch(() => {
      const cur = store.get(key);
      if (cur && cur.p === p) store.delete(key);
    });
    if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
    return p;
  };
}

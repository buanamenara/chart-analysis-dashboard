// Utilitas candle bersama (Yahoo, bursa crypto, indikator).

// Durasi tiap timeframe (ms).
export const INTERVAL_MS = {
  "1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3,
  "60m": 3600e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3, "1wk": 604800e3
};

const WEEK_MONDAY_OFFSET = 4 * 86400e3; // epoch 1970-01-01 = Kamis -> minggu mulai Senin

// Awal periode candle yang memuat waktu t (4h: 00/04/08.. UTC, minggu: Senin 00:00 UTC).
export function bucketStart(t, intervalMs) {
  const offset = intervalMs === INTERVAL_MS["1wk"] ? WEEK_MONDAY_OFFSET : 0;
  return Math.floor((t - offset) / intervalMs) * intervalMs + offset;
}

// Gabungkan candle ke timeframe lebih besar dengan batas waktu SELARAS, bukan per-N
// candle — jadi tetap benar walau ada candle yang hilang (data bolong).
export function aggregateAligned(bars, intervalMs) {
  const out = [];
  for (const b of bars) {
    const start = bucketStart(b.time, intervalMs);
    const cur = out.at(-1);
    if (cur && cur.time === start) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
    } else {
      out.push({ time: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });
    }
  }
  return out;
}

// Yahoo menambahkan satu titik "live" di akhir data dengan stempel waktu harga terakhir
// (mis. 00:25:45), terpisah dari candle periode itu (00:00). Titik itu:
//  - masih di dalam periode candle sebelumnya -> digabung ke candle itu (bukan candle baru);
//  - sudah di periode baru -> stempel waktunya diselaraskan ke awal periode.
// Volume titik live tidak ditambahkan (Yahoo sudah memasukkannya / sering 0).
export function mergeTrailingLivePoint(bars, intervalMs) {
  if (!intervalMs || bars.length < 2) return bars;
  const last = bars.at(-1);
  const prev = bars.at(-2);
  if (last.time - prev.time < intervalMs && last.time !== prev.time) {
    prev.close = last.close;
    prev.high = Math.max(prev.high, last.high, last.close);
    prev.low = Math.min(prev.low, last.low, last.close);
    bars.pop();
  } else if (last.time % intervalMs !== 0 && intervalMs < INTERVAL_MS["1d"]) {
    last.time = bucketStart(last.time, intervalMs);
  }
  return bars;
}

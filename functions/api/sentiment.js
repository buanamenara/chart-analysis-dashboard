import { getFearGreedIndex, getCryptoGlobalStats } from "../../lib/sentiment.js";

export async function onRequestGet() {
  try {
    const [fngResult, globalResult] = await Promise.allSettled([getFearGreedIndex(), getCryptoGlobalStats()]);
    return Response.json({
      fearGreed: fngResult.status === "fulfilled" ? fngResult.value : null,
      cryptoGlobal: globalResult.status === "fulfilled" ? globalResult.value : null
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

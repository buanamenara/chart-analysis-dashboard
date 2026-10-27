import { fetchQuote } from "../../lib/marketData.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const assetType = searchParams.get("assetType");
  if (!symbol || !assetType) {
    return Response.json({ error: "symbol & assetType wajib diisi" }, { status: 400 });
  }
  try {
    const quote = await fetchQuote(assetType, symbol);
    return Response.json(quote);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

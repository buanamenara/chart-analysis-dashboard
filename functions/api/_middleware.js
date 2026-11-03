import { assetTypeError } from "../../lib/marketData.js";

// Berlaku untuk semua functions/api/*. Padanan Express: middleware "/api" di server.js.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const err = assetTypeError(url.searchParams.get("assetType"));
  if (err) {
    return new Response(JSON.stringify(err), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  return context.next();
}

import { getStore } from "@netlify/blobs";

// Remove duplicate cards that share the same or very similar quotes
// Usage: /.netlify/functions/dedup-cards?type=potus  (or type=main, or omit for both)
// DELETE after use

function normalizeQuote(q) {
  return (q || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function similarity(a, b) {
  const wordsA = a.split(" ");
  const wordsB = new Set(b.split(" "));
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.size);
}

async function dedupStore(store, key) {
  const raw = await store.get(key);
  const cards = raw ? JSON.parse(raw) : [];
  const before = cards.length;

  const kept = [];
  const removed = [];

  for (const card of cards) {
    const norm = normalizeQuote(card.quote);
    const isDupe = kept.some(k => {
      const kNorm = normalizeQuote(k.quote);
      // Exact match or >60% word overlap = duplicate
      return kNorm === norm || similarity(norm, kNorm) > 0.6;
    });

    if (isDupe) {
      removed.push({ id: card.id, speaker: card.speaker, quote: (card.quote || "").slice(0, 80) });
    } else {
      kept.push(card);
    }
  }

  await store.set(key, JSON.stringify(kept));
  return { before, after: kept.length, removed };
}

export default async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "both";
  const store = getStore({ name: "analyses", consistency: "strong" });

  const results = {};

  if (type === "main" || type === "both") {
    results["main-analyses"] = await dedupStore(store, "main-analyses");
  }
  if (type === "potus" || type === "both") {
    results["potus-analyses"] = await dedupStore(store, "potus-analyses");
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

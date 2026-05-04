import { getStore } from "@netlify/blobs";

// List all speaker names in both stores
// DELETE after use

export default async (req) => {
  const store = getStore({ name: "analyses", consistency: "strong" });
  const results = {};

  for (const key of ["main-analyses", "potus-analyses"]) {
    const raw = await store.get(key);
    const cards = raw ? JSON.parse(raw) : [];
    results[key] = cards.map(c => ({ id: c.id, speaker: c.speaker }));
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

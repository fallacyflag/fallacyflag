import { getStore } from "@netlify/blobs";

// Remove cards by speaker name
// Usage: /.netlify/functions/remove-cards?speaker=Molly+Olmstead
// DELETE after use

export default async (req) => {
  const url = new URL(req.url);
  const speaker = url.searchParams.get("speaker");

  if (!speaker) {
    return new Response(JSON.stringify({ error: "Provide ?speaker=Name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const store = getStore({ name: "analyses", consistency: "strong" });
  const results = {};

  for (const key of ["main-analyses", "potus-analyses"]) {
    const raw = await store.get(key);
    const cards = raw ? JSON.parse(raw) : [];
    const before = cards.length;
    const filtered = cards.filter(c =>
      !c.speaker?.toLowerCase().includes(speaker.toLowerCase())
    );
    await store.set(key, JSON.stringify(filtered));
    results[key] = { before, after: filtered.length, removed: before - filtered.length };
  }

  return new Response(JSON.stringify({ speaker, ...results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

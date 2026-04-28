import { getStore } from "@netlify/blobs";

// Fix specific card fields
// Usage: /.netlify/functions/fix-card?speaker=Riley+Moore&fixTopics=true
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
    let fixed = 0;

    for (const card of cards) {
      if (card.speaker && card.speaker.toLowerCase().includes(speaker.toLowerCase())) {
        // Fix "Security" -> "National Security"
        if (card.topics && Array.isArray(card.topics)) {
          card.topics = card.topics.map(t => t === "Security" ? "National Security" : t);
          fixed++;
        }
      }
    }

    if (fixed > 0) {
      await store.set(key, JSON.stringify(cards));
    }
    results[key] = { fixed };
  }

  return new Response(JSON.stringify({ speaker, ...results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

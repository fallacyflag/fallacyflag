import { getStore } from "@netlify/blobs";

// Clean up speaker names in existing cards — strip titles, merge duplicates
// Usage: /.netlify/functions/fix-speakers
// DELETE after use

const TITLE_PREFIXES = /^(president|vice president|senator|sen\.|rep\.|representative|congressman|congresswoman|governor|gov\.|mayor|secretary|secretary of \w+|defense secretary|speaker|leader|chair|chairman|chairwoman|commissioner|ambassador|director|administrator|dr\.|mr\.|mrs\.|ms\.)\s+/i;

function cleanSpeakerName(speaker) {
  if (!speaker) return speaker;
  let name = speaker.trim();
  name = name.replace(/^[\w.]+\s+(president|chair|director|secretary|administrator)\s+/i, "");
  let prev;
  do { prev = name; name = name.replace(TITLE_PREFIXES, ""); } while (name !== prev);
  name = name.replace(/\s*\([RDIL]-\w{2}\)\s*$/, "").trim();
  return name || speaker;
}

async function fixStore(store, key) {
  const raw = await store.get(key);
  const cards = raw ? JSON.parse(raw) : [];
  const changes = [];

  for (const card of cards) {
    const cleaned = cleanSpeakerName(card.speaker);
    if (cleaned !== card.speaker) {
      changes.push({ id: card.id, from: card.speaker, to: cleaned });
      card.speaker = cleaned;
    }
  }

  if (changes.length > 0) {
    await store.set(key, JSON.stringify(cards));
  }

  return { total: cards.length, fixed: changes.length, changes };
}

export default async (req) => {
  const store = getStore({ name: "analyses", consistency: "strong" });

  const results = {
    "main-analyses": await fixStore(store, "main-analyses"),
    "potus-analyses": await fixStore(store, "potus-analyses"),
  };

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

import { getStore } from "@netlify/blobs";

// Clean up speaker names in existing cards
// Usage: /.netlify/functions/fix-speakers
// DELETE after use

// Explicit mapping for known bad names
const NAME_FIXES = {
  "trump": "Donald Trump",
  "of defense pete hegseth": "Pete Hegseth",
  "centers for medicare & medicaid services administrator mehmet oz": "Mehmet Oz",
  "centers for medicare and medicaid services administrator mehmet oz": "Mehmet Oz",
  "secret service director sean curran": "Sean Curran",
  "drew gonshorowski, nebraska medicaid director": "Drew Gonshorowski",
  "republican indiana state senator spencer deery": "Spencer Deery",
  "north carolina state sen. amy galey, a republican": "Amy Galey",
  "acting attorney general todd blanche": "Todd Blanche",
  "first lady melania trump": "Melania Trump",
  "florida gov. ron desantis": "Ron DeSantis",
  "casey means": "Casey Means",
};

function cleanSpeakerName(speaker) {
  if (!speaker) return speaker;
  const lower = speaker.trim().toLowerCase();

  // Check explicit fixes first
  if (NAME_FIXES[lower]) return NAME_FIXES[lower];

  // Strip common title patterns
  let name = speaker.trim();
  // "Riley Moore, R - West Virginia" -> "Riley Moore"
  name = name.replace(/,\s*[RDI]\s*[-–]\s*\w[\w\s]*$/, "");
  // "Sen. X" "Rep. X" "Gov. X" "Dr. X" etc.
  name = name.replace(/^(Sen\.|Rep\.|Gov\.|Dr\.|Mr\.|Mrs\.|Ms\.|Secretary|President|Vice President|Senator|Representative|Governor|Speaker|Director|Administrator|Commissioner|Ambassador|Chairman|Chairwoman)\s+/i, "");
  // "X, title description" -> "X"
  name = name.replace(/,\s*(a\s+)?(Republican|Democrat|Independent|senator|representative|director|administrator|professor|attorney|lawyer).*$/i, "");

  return name.trim() || speaker;
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

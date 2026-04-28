import { getStore } from "@netlify/blobs";

// Remove cards where the speaker is a journalist/pundit rather than a political figure
// Usage: /.netlify/functions/remove-journalists
// DELETE after use

const POLITICAL_TITLES = [
  "president", "vice president", "senator", "sen.", "rep.", "representative",
  "congressman", "congresswoman", "governor", "gov.", "mayor", "secretary",
  "attorney general", "speaker", "leader", "whip", "chair", "commissioner",
  "ambassador", "counsel", "director", "administrator", "candidate",
  "first lady", "former president", "donald trump", "joe biden",
  "treasurer", "comptroller", "auditor", "delegate", "assemblyman",
  "assemblywoman", "minority", "majority", "caucus",
  "d-", "r-", "i-", "(d", "(r", "(i",
  "-al)", "-ak)", "-az)", "-ar)", "-ca)", "-co)", "-ct)", "-de)", "-fl)",
  "-ga)", "-hi)", "-id)", "-il)", "-in)", "-ia)", "-ks)", "-ky)", "-la)",
  "-me)", "-md)", "-ma)", "-mi)", "-mn)", "-ms)", "-mo)", "-mt)", "-ne)",
  "-nv)", "-nh)", "-nj)", "-nm)", "-ny)", "-nc)", "-nd)", "-oh)", "-ok)",
  "-or)", "-pa)", "-ri)", "-sc)", "-sd)", "-tn)", "-tx)", "-ut)", "-vt)",
  "-va)", "-wa)", "-wv)", "-wi)", "-wy)", "-dc)",
];

function looksLikePolitician(speaker) {
  const lower = (speaker || "").toLowerCase();
  return POLITICAL_TITLES.some(title => lower.includes(title));
}

async function scrubStore(store, key) {
  const raw = await store.get(key);
  const cards = raw ? JSON.parse(raw) : [];
  const before = cards.length;

  const kept = [];
  const removed = [];

  for (const card of cards) {
    if (looksLikePolitician(card.speaker)) {
      kept.push(card);
    } else {
      removed.push({
        id: card.id,
        speaker: card.speaker,
        quote: (card.quote || "").slice(0, 80)
      });
    }
  }

  await store.set(key, JSON.stringify(kept));
  return { before, after: kept.length, removed };
}

export default async (req) => {
  const store = getStore({ name: "analyses", consistency: "strong" });

  const results = {
    "main-analyses": await scrubStore(store, "main-analyses"),
    "potus-analyses": await scrubStore(store, "potus-analyses"),
  };

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const CARDS_PER_RUN = 5;
const MAX_ANALYSES = 60;

// ── FALLACY TYPES & NORMALIZATION ──
const FALLACY_TYPES = [
  "adHominem", "strawMan", "slipperySlope", "falseDilemma",
  "appealToAuthority", "bandwagon", "redHerring", "tuQuoque",
  "appealToEmotion", "hastyGeneralization", "noTrueScotsman", "circularReasoning"
];

const VALID_TYPES = new Set([...FALLACY_TYPES, "fairPlay"]);
const TYPE_ALIASES = Object.fromEntries([
  ...FALLACY_TYPES.map(k => [k.toLowerCase(), k]),
  ["ad_hominem","adHominem"],["straw_man","strawMan"],["strawman","strawMan"],
  ["slippery_slope","slipperySlope"],["slipperyslope","slipperySlope"],
  ["false_dilemma","falseDilemma"],["falsedilemma","falseDilemma"],
  ["appeal_to_authority","appealToAuthority"],["appealtoauthority","appealToAuthority"],
  ["red_herring","redHerring"],["redherring","redHerring"],
  ["tu_quoque","tuQuoque"],["tuquoque","tuQuoque"],["whataboutism","tuQuoque"],
  ["appeal_to_emotion","appealToEmotion"],["appealtoemotion","appealToEmotion"],
  ["hasty_generalization","hastyGeneralization"],["hastygeneralization","hastyGeneralization"],
  ["no_true_scotsman","noTrueScotsman"],["notruescotsman","noTrueScotsman"],
  ["circular_reasoning","circularReasoning"],["circularreasoning","circularReasoning"],
  ["fair_play","fairPlay"],["fairplay","fairPlay"],
  ["ad hominem","adHominem"],["straw man","strawMan"],["slippery slope","slipperySlope"],
  ["false dilemma","falseDilemma"],["appeal to authority","appealToAuthority"],
  ["red herring","redHerring"],["tu quoque","tuQuoque"],["appeal to emotion","appealToEmotion"],
  ["hasty generalization","hastyGeneralization"],["no true scotsman","noTrueScotsman"],
  ["circular reasoning","circularReasoning"],["fair play","fairPlay"],
  ["bandwagon / ad populum","bandwagon"],["ad populum","bandwagon"],["adpopulum","bandwagon"],
  ["strawmanargument","strawMan"],["strawman_argument","strawMan"],
  ["cherrypickingdata","hastyGeneralization"],["cherry_picking_data","hastyGeneralization"],
  ["cherrypicking","hastyGeneralization"],["cherry_picking","hastyGeneralization"],
  ["posthocfallacy","circularReasoning"],["post_hoc_fallacy","circularReasoning"],
  ["posthoc","circularReasoning"],["post_hoc","circularReasoning"],
  ["loadedlanguage","appealToEmotion"],["loaded_language","appealToEmotion"],
  ["hyperbole","appealToEmotion"],["overstatement","appealToEmotion"],["exaggeration","appealToEmotion"],
  ["emotionalappeal","appealToEmotion"],["emotional_appeal","appealToEmotion"],
  ["falseequivalence","falseDilemma"],["false_equivalence","falseDilemma"],
  ["falseanalogy","falseDilemma"],["false_analogy","falseDilemma"],
  ["movingthegoalposts","noTrueScotsman"],["moving_the_goalposts","noTrueScotsman"],
  ["poisoningthewell","adHominem"],["poisoning_the_well","adHominem"],
  ["geneticfallacy","adHominem"],["genetic_fallacy","adHominem"],
  ["beggingthequestion","circularReasoning"],["begging_the_question","circularReasoning"],
]);

function normalizeType(t) {
  if (!t) return t;
  if (VALID_TYPES.has(t)) return t;
  return TYPE_ALIASES[t.toLowerCase()] || t;
}

function normalizeAnalyses(arr) {
  return arr.map(a => ({
    ...a,
    fallacies: (a.fallacies || []).map(f => ({ ...f, type: normalizeType(f.type) }))
  }));
}

// ── RSS FEED SOURCES ──
// These feeds include actual article descriptions (not empty like Google News RSS).
const GENERAL_FEEDS = [
  "https://feeds.npr.org/1014/rss.xml",                              // NPR Politics
  "https://rss.politico.com/politics-news.xml",                      // Politico
  "https://thehill.com/feed/",                                       // The Hill
  "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",      // BBC US & Canada
  "https://www.pbs.org/newshour/feeds/rss/politics",                 // PBS NewsHour
  "https://abcnews.go.com/abcnews/politicsheadlines",               // ABC News Politics
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",      // NYT Politics
  "https://moxie.foxnews.com/google-publisher/politics.xml",        // Fox News Politics
  "https://feeds.reuters.com/reuters/politicsNews",                  // Reuters Politics
  "https://rss.cnn.com/rss/cnn_allpolitics.rss",                    // CNN Politics
  "https://www.washingtontimes.com/rss/headlines/news/politics/",    // Washington Times Politics
];

const POTUS_FEEDS = [
  "https://www.whitehouse.gov/feed/",                                // White House official — remarks, statements, EOs
  "https://www.whitehouse.gov/briefing-room/feed/",                  // White House Briefing Room
  "https://feeds.npr.org/1014/rss.xml",                              // NPR Politics
  "https://rss.politico.com/politics-news.xml",                      // Politico
  "https://rss.politico.com/whitehouse.xml",                         // Politico White House
  "https://thehill.com/feed/",                                       // The Hill
  "https://thehill.com/homenews/administration/feed/",               // The Hill - Administration
  "https://moxie.foxnews.com/google-publisher/politics.xml",        // Fox News Politics
  "https://abcnews.go.com/abcnews/politicsheadlines",               // ABC News Politics
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",      // NYT Politics
  "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",      // BBC US & Canada
  "https://www.pbs.org/newshour/feeds/rss/politics",                 // PBS NewsHour
  "https://feeds.reuters.com/reuters/politicsNews",                  // Reuters Politics
  "https://rss.cnn.com/rss/cnn_allpolitics.rss",                    // CNN Politics
  "https://www.washingtontimes.com/rss/headlines/news/politics/",    // Washington Times Politics
  "https://feeds.feedburner.com/breitbart",                          // Breitbart — frequently quotes Trump directly
  "https://www.newsmax.com/rss/Politics/16/",                        // Newsmax Politics
];

// ── RSS FETCHING & PARSING ──
async function fetchWithTimeout(url, opts = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchRSS(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "FallacyFlag/1.0 (political rhetoric analyzer)" }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSSItems(xml);
  } catch (e) {
    console.log(`[rss] failed: ${url} — ${e.message}`);
    return [];
  }
}

function parseRSSItems(xml) {
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = block.match(new RegExp(`<${tag}[^>]*?>([\\s\\S]*?)<\\/${tag}>`));
      return r ? stripMarkup(r[1]) : "";
    };
    // Handle <link> which sometimes has URL as text, sometimes as next line
    let link = get("link");
    if (!link) {
      const linkMatch = block.match(/<link[^>]*href="([^"]*)"/);
      if (linkMatch) link = linkMatch[1];
    }
    items.push({
      title: get("title"),
      description: get("description"),
      link,
      pubDate: get("pubDate"),
    });
  }
  return items.filter(it => it.title); // skip empty items
}

function stripMarkup(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// ── ARTICLE FETCHING (best-effort) ──
async function fetchArticleText(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FallacyFlag/1.0)" },
      redirect: "follow",
    }, 6000);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    const html = await res.text();
    // Strip non-content elements, then all tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 5000);
  } catch (e) {
    return null;
  }
}

// ── PROMPT CONSTANTS ──
const SEVERITY_RULES = `
Rating system:
- "green" (FAIR PLAY): Sound reasoning. Cites evidence, acknowledges counterarguments, logically structured.
- "yellow" (YELLOW CARD): 1-2 common fallacies. Bad reasoning but garden-variety political rhetoric.
- "red" (RED CARD): 2+ fallacies with clearly misleading intent, or a single fallacy deployed in an egregiously manipulative way designed to bypass rational thought.
`;

const TONE_GUIDANCE = `
VOICE & TONE — CRITICAL:
Every analysis must be written in FallacyFlag's signature voice: dry, knowing, subtly witty. Think "smart friend who watches C-SPAN for fun."

Rules:
- Every fallacy analysis MUST end with a memorable one-liner or wry observation.
- Fair Play analyses should express genuine (slightly surprised) appreciation for good reasoning.
- Never be mean to the speaker — be precise about the reasoning. The target is always the argument, never the person.
- Vary the humor — don't repeat the same joke structure across multiple cards.
`;

const RULING_TERMS = `
Ruling labels — each fallacy type maps to a thematic soccer infraction:
- False Dilemma → "HANDBALL"
- Slippery Slope → "OFFSIDE"
- Straw Man → "SIMULATION"
- Ad Hominem → "SHIRT PULL"
- Red Herring → "TIME WASTING"
- Tu Quoque (Whataboutism) → "OBSTRUCTION"
- Hasty Generalization → "ENCROACHMENT"
- No True Scotsman → "ILLEGAL SUBSTITUTION"
- Appeal to Authority / Bandwagon → "HANDBALL"
- Appeal to Emotion → "SIMULATION" for yellow, "PROFESSIONAL FOUL" for red
- Circular Reasoning → "OBSTRUCTION"
- For egregious red cards: "VIOLENT CONDUCT", "PROFESSIONAL FOUL", "DANGEROUS PLAY"
- For fair play: "FAIR PLAY"
IMPORTANT: Always use a soccer infraction term, never raw color names.
`;

const TOPIC_LIST = [
  "Iran", "Foreign Policy", "Immigration", "Border Security",
  "Gun Policy", "Healthcare", "Drug Pricing", "Economy",
  "Federal Budget", "Tax Policy", "AI Regulation", "Big Tech",
  "Climate", "Energy", "Trade", "Regulatory Reform",
  "Education", "Partisanship", "Party Loyalty", "Legal/DOJ",
  "Media", "National Security", "DHS/TSA", "SAVE Act",
  "Social Security", "Veterans", "Labor", "Housing"
];

// ── PROMPT BUILDER ──
function buildPrompt(sourceMaterial, existingIds, existingQuotes, isPotus) {
  const today = new Date().toISOString().slice(0, 10);

  const speakerGuidance = isPotus
    ? `SPEAKER CONSTRAINT — THIS IS THE POTUS PAGE:
Every analysis MUST be about President Donald Trump. Use his direct quotes when available, but you may also analyze claims attributed to him through paraphrase (e.g. "Trump said he would...", "the president argued that..."), official White House statements, executive orders, and reported remarks. The speaker field should always read "President Donald Trump" or "Donald Trump".`
    : `Include a diverse mix of political figures. Vary party affiliation. Include Fair Play (green) examples when the source material contains well-reasoned arguments.`;

  return `You are the editorial engine for FallacyFlag, a nonpartisan site that analyzes political rhetoric for logical fallacies using a soccer-themed rating system.

Today is ${today}.

Below is REAL political news coverage gathered from RSS feeds. Your job is to:
1. Read through ALL the source material carefully
2. Identify up to ${CARDS_PER_RUN} notable political claims, arguments, or direct quotes
3. Analyze each one for logical fallacies

════════════════════════════════════════════
ABSOLUTE RULES — VIOLATION = FAILURE:
════════════════════════════════════════════
• You may ONLY analyze quotes and claims that appear in the source material below.
• If the source contains a DIRECT QUOTE (in quotation marks), use it VERBATIM.
• If the source only paraphrases a claim (e.g. "Senator X argued that..."), you may use the paraphrase but attribute it clearly as reported speech.
• Do NOT invent, fabricate, recall from memory, or embellish ANY quotes.
• Do NOT attribute quotes to people who are not mentioned in the source material.
• The speaker field must match exactly how the person is identified in the source.
• The context field should reflect when/where the statement was made per the source.
• Include the sourceRef number (e.g. [3]) indicating which source article the quote comes from.
• SPEAKERS: Only analyze quotes from POLITICAL FIGURES — elected officials, candidates, cabinet members, governors, presidents, party leaders, and political appointees. NEVER analyze quotes from journalists, reporters, TV hosts, professors, commentators, pundits, or media personalities. If a journalist quotes a politician, analyze the POLITICIAN'S quote, not the journalist's commentary.
• DEDUPLICATION: If the same quote, claim, or statement appears in multiple source articles, only create ONE card for it. Pick the source with the most complete quote or context. Never create multiple cards for the same underlying statement just because different outlets covered it.
• If you cannot find ${CARDS_PER_RUN} DISTINCT analyzable claims from political figures in the source material, return FEWER cards. Returning 2-3 good unique cards is far better than padding with duplicates or fabricated ones.
• NEVER make up a quote to fill a quota. This is a credibility-critical application.
════════════════════════════════════════════

${speakerGuidance}

=== SOURCE MATERIAL (from news RSS feeds, ${today}) ===
${sourceMaterial}
=== END SOURCE MATERIAL ===

${SEVERITY_RULES}
${TONE_GUIDANCE}
${RULING_TERMS}

Available topics: ${TOPIC_LIST.join(", ")}

Available fallacy types: ${FALLACY_TYPES.join(", ")}
For fair play entries, use type: "fairPlay"
CRITICAL: The "type" field must be one of the exact strings above.

EXISTING IDs to avoid: ${existingIds.join(", ")}

EXISTING QUOTES already on the site — do NOT create cards for any of these quotes or substantially similar claims:
${existingQuotes}

RESPONSE FORMAT — CRITICAL:
Return ONLY a raw JSON array. Do NOT include any text, commentary, explanation, or reasoning before or after the JSON. Your entire response must start with [ and end with ]. If you cannot find any analyzable quotes in the source material, return an empty array: []

Each object must have:
- id (unique integer above ${isPotus ? 5000 : 1000})
- date ("${today}")
- topics (array of 1-3 relevant topics from the available list)
- quote (the EXACT quote or reported claim FROM THE SOURCE MATERIAL)
- speaker (full name and title AS IDENTIFIED in the source)
- context (where/when said, per the source article)
- sourceRef (integer — which source article number this came from, e.g. 3)
- sourceUrl (URL of the source article)
- fallacies (array of {type, ruling, analysis} — EVERY fallacy MUST include a 2-3 sentence "analysis" string)
- severity ("green"/"yellow"/"red")
- tweetVersion (brief one-line summary placeholder)`;
}

// ── GATHER SOURCE MATERIAL ──
async function gatherSources(feeds, isPotus = false) {
  // Fetch all RSS feeds in parallel
  const feedResults = await Promise.all(feeds.map(fetchRSS));
  const allItems = feedResults.flat();

  if (allItems.length === 0) {
    throw new Error("No RSS feeds returned data — cannot generate cards without real sources");
  }

  // Deduplicate by title similarity
  const seen = new Set();
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Take top 20 items (enough variety without blowing up prompt size)
  const top = unique.slice(0, 20);

  // Try to fetch full article text for top items with direct links
  const articleFetchLimit = isPotus ? 8 : 8;  // Fetch more full articles to find politician quotes
  const enriched = await Promise.all(
    top.map(async (item, i) => {
      if (i < articleFetchLimit && item.link && !item.link.includes("news.google.com")) {
        const fullText = await fetchArticleText(item.link);
        return { ...item, fullText };
      }
      return item;
    })
  );

  // Build formatted source material
  const sourceMaterial = enriched.map((item, i) => {
    let entry = `[${i + 1}] "${item.title}"`;
    if (item.pubDate) entry += `\n    Published: ${item.pubDate}`;
    if (item.description) entry += `\n    Summary: ${item.description}`;
    if (item.fullText) entry += `\n    Article text: ${item.fullText.slice(0, 5000)}`;
    if (item.link) entry += `\n    URL: ${item.link}`;
    return entry;
  }).join("\n\n");

  const withText = enriched.filter(i => i.fullText).length;
  const withDesc = enriched.filter(i => i.description && i.description.length > 20).length;
  console.log(`[sources] gathered ${enriched.length} articles (${withText} with full text, ${withDesc} with descriptions)`);

  // Safety check: if we have almost no content, throw so it shows in errors
  if (withText === 0 && withDesc < 3) {
    throw new Error(`Insufficient source material: ${enriched.length} articles but only ${withDesc} with descriptions and ${withText} with full text`);
  }

  return sourceMaterial;
}

// ── GENERATE CARDS FOR A PAGE TYPE ──
async function generateForType(client, store, isPotus) {
  const storeKey = isPotus ? "potus-analyses" : "main-analyses";
  const today = new Date().toISOString().slice(0, 10);
  const feeds = isPotus ? POTUS_FEEDS : GENERAL_FEEDS;

  // Step 1: Gather real source material
  const sourceMaterial = await gatherSources(feeds, isPotus);

  // Step 2: Get existing analyses
  const raw = await store.get(storeKey);
  const existing = raw ? JSON.parse(raw) : [];
  const existingIds = existing.map(a => a.id);
  const existingQuotes = existing.map(a => `- "${(a.quote || "").slice(0, 100)}" (${a.speaker || "unknown"})`).join("\n");

  // Step 3: Claude analyzes real source material
  const prompt = buildPrompt(sourceMaterial, existingIds, existingQuotes, isPotus);

  let response;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      });
      break;
    } catch (apiErr) {
      const status = apiErr?.status || apiErr?.statusCode;
      const isRetryable = status === 529 || status === 503 || status === 500;
      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = (attempt + 1) * 2000;
        console.log(`[api] retry ${attempt + 1}/${MAX_RETRIES} after ${status}, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw apiErr;
    }
  }

  // Step 4: Parse and store
  let text = response.content[0].text.trim();
  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Find the JSON array — use a balanced approach
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e1) {
    // Try extracting just the array portion
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch (e2) {
        // Extracted portion wasn't valid JSON either — treat as 0 cards
        console.log(`[parse] Extracted text between [ and ] wasn't valid JSON, treating as empty. Response starts with: ${text.slice(0, 200)}`);
        parsed = [];
      }
    } else {
      // No JSON array at all — Claude wrote commentary instead. Treat as 0 cards.
      console.log(`[parse] No JSON array found, treating as empty. Response starts with: ${text.slice(0, 200)}`);
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  // ── HARD FILTERS (applied after Claude returns cards) ──

  // 1. Block journalists/non-politicians
  const JOURNALIST_KEYWORDS = [
    "reporter", "correspondent", "journalist", "editor", "columnist",
    "anchor", "host", "writer", "analyst", "commentator", "pundit",
    "contributor", "professor", "attorney", "lawyer", "staff writer",
    "npr", "cnn", "msnbc", "fox news", "abc news", "cbs news",
    "nbc news", "pbs", "slate", "politico", "associated press",
  ];
  const POLITICAL_KEYWORDS = [
    "president", "vice president", "senator", "sen.", "rep.",
    "representative", "congressman", "congresswoman", "governor", "gov.",
    "mayor", "secretary", "speaker", "leader", "whip", "chair",
    "commissioner", "ambassador", "candidate", "first lady",
    "treasurer", "comptroller", "auditor", "marshal", "sheriff",
    "alderman", "alderwoman", "councilmember", "delegate", "assemblyman",
    "assemblywoman", "minority", "majority", "caucus",
    "d-", "r-", "i-", "(d", "(r", "(i",
    "-al)", "-ak)", "-az)", "-ar)", "-ca)", "-co)", "-ct)", "-de)", "-fl)",
    "-ga)", "-hi)", "-id)", "-il)", "-in)", "-ia)", "-ks)", "-ky)", "-la)",
    "-me)", "-md)", "-ma)", "-mi)", "-mn)", "-ms)", "-mo)", "-mt)", "-ne)",
    "-nv)", "-nh)", "-nj)", "-nm)", "-ny)", "-nc)", "-nd)", "-oh)", "-ok)",
    "-or)", "-pa)", "-ri)", "-sc)", "-sd)", "-tn)", "-tx)", "-ut)", "-vt)",
    "-va)", "-wa)", "-wv)", "-wi)", "-wy)", "-dc)",
  ];

  function isPolitician(speaker) {
    const lower = (speaker || "").toLowerCase();
    // If it matches a political title, keep it
    if (POLITICAL_KEYWORDS.some(k => lower.includes(k))) return true;
    // If it matches a journalist keyword, reject it
    if (JOURNALIST_KEYWORDS.some(k => lower.includes(k))) return false;
    // Unknown — let it through
    return true;
  }

  // 2. Block duplicate quotes (compare against existing store)
  function normalizeForDedup(q) {
    return (q || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }
  function quoteSimilarity(a, b) {
    const wordsA = a.split(" ");
    const wordsB = new Set(b.split(" "));
    const overlap = wordsA.filter(w => wordsB.has(w)).length;
    return overlap / Math.max(wordsA.length, wordsB.size);
  }
  const existingNorms = existing.map(a => normalizeForDedup(a.quote));

  const filtered = parsed.filter(card => {
    // Check politician
    if (!isPolitician(card.speaker)) {
      console.log(`[filter] Rejected non-politician: ${card.speaker}`);
      return false;
    }
    // Check duplicate
    const norm = normalizeForDedup(card.quote);
    const isDupe = existingNorms.some(eq => eq === norm || quoteSimilarity(norm, eq) > 0.5);
    if (isDupe) {
      console.log(`[filter] Rejected duplicate quote from: ${card.speaker}`);
      return false;
    }
    // Add to existing norms so we also dedup within this batch
    existingNorms.push(norm);
    return true;
  });

  const newCards = normalizeAnalyses(filtered).map(a => ({
    ...a,
    date: today,
    created_at: new Date().toISOString(),
  }));

  const updated = [...newCards, ...existing].slice(0, MAX_ANALYSES);
  await store.set(storeKey, JSON.stringify(updated));

  console.log(`[generate] ${isPotus ? "potus" : "main"}: added ${newCards.length} cards (total: ${updated.length})`);
  return { added: newCards.length, total: updated.length };
}

// ── HANDLER ──
export default async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const client = new Anthropic({ apiKey });
  const store = getStore({ name: "analyses", consistency: "strong" });

  // Determine which page to generate: ?type=potus, ?type=main, or both (default)
  let type = "both";
  try {
    const url = new URL(req.url);
    type = url.searchParams.get("type") || "both";
  } catch (e) { /* default to both */ }

  const results = { errors: [] };

  try {
    if (type === "main" || type === "both") {
      results.main = await generateForType(client, store, false);
    }
  } catch (e) {
    console.error(`[generate] main failed:`, e);
    results.errors.push({ page: "main", error: e.message });
  }

  try {
    if (type === "potus" || type === "both") {
      results.potus = await generateForType(client, store, true);
    }
  } catch (e) {
    console.error(`[generate] potus failed:`, e);
    results.errors.push({ page: "potus", error: e.message });
  }

  return new Response(JSON.stringify(results), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};

export const config = {
  schedule: "0 10 */3 * *"
};

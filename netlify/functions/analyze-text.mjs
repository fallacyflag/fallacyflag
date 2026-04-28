import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

// ── ANALYSIS CACHE ──
// In-memory cache: same input text always returns the same analysis
// Persists while the function instance is warm (same as rate limiter)
const analysisCache = new Map();
const CACHE_MAX = 200;          // max cached analyses
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(text, hasImage) {
  // Hash the input so cache keys are fixed-length
  return createHash("sha256").update(text + (hasImage ? ":img" : "")).digest("hex");
}

function getCached(key) {
  const entry = analysisCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { analysisCache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  // Evict oldest entries if cache is full
  if (analysisCache.size >= CACHE_MAX) {
    const oldest = analysisCache.keys().next().value;
    analysisCache.delete(oldest);
  }
  analysisCache.set(key, { data, ts: Date.now() });
}

// ── RATE LIMITER ──
// In-memory store: persists while the function instance is warm
const RATE_LIMIT = 10;        // max requests per window
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  // Clean up stale entries periodically (every 100 checks)
  if (rateBuckets.size > 500) {
    for (const [key, val] of rateBuckets) {
      if (now - val.windowStart > RATE_WINDOW) rateBuckets.delete(key);
    }
  }

  if (!bucket || now - bucket.windowStart > RATE_WINDOW) {
    rateBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count++;
  if (bucket.count > RATE_LIMIT) return true;
  return false;
}

const FALLACY_TYPES = [
  "adHominem", "strawMan", "slipperySlope", "falseDilemma",
  "appealToAuthority", "bandwagon", "redHerring", "tuQuoque",
  "appealToEmotion", "hastyGeneralization", "noTrueScotsman", "circularReasoning"
];

const SEVERITY_RULES = `
Rating system:
- "green" (FAIR PLAY): Sound reasoning. Cites evidence, acknowledges counterarguments, logically structured. The argument may still be debatable, but the reasoning itself is clean.
- "yellow" (YELLOW CARD): 1-2 common fallacies. Bad reasoning but garden-variety political rhetoric — the kind of thing most people do without thinking.
- "red" (RED CARD): 3+ stacked fallacies, or egregiously manipulative rhetoric designed to bypass rational thought.
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
- Cherry Picking → "HANDBALL"
- Loaded Language → "SHIRT PULL"
- For egregious red cards: "VIOLENT CONDUCT", "PROFESSIONAL FOUL", "DANGEROUS PLAY"
- For fair play: "FAIR PLAY"
IMPORTANT: Always use a soccer infraction term, never raw color names.
`;

function buildAnalysisPrompt(text, hasImage) {
  const textBlock = text ? `\n=== TEXT TO ANALYZE ===\n${text}\n=== END TEXT ===\n` : '';
  const sourceDesc = hasImage && text
    ? 'A user has submitted a screenshot along with text for analysis. Analyze BOTH the image content and the provided text.'
    : hasImage
    ? 'A user has submitted a screenshot of an argument or quote for analysis. Read and extract the text from the image, then perform your analysis on it.'
    : 'A user has submitted the following argument or quote for analysis.';

  return `You are the editorial engine for FallacyFlag, a nonpartisan site that analyzes political rhetoric for logical fallacies using a soccer-themed rating system.

${sourceDesc} Perform a THOROUGH, DEEP analysis — do not just look for keywords. Consider the full logical structure, implicit assumptions, rhetorical moves, and reasoning patterns.
${textBlock}

ANALYSIS INSTRUCTIONS:
1. Read the entire argument carefully. Understand what claim is being made and how it's being supported.
2. Identify the logical structure: What is the conclusion? What are the premises? Are the premises actually supporting the conclusion?
3. Look for SUBTLE fallacies, not just obvious keyword triggers. A straw man doesn't require the words "so you're saying" — it happens whenever someone misrepresents an opposing position. An appeal to emotion doesn't require the word "children" — it happens whenever emotional weight substitutes for logical reasoning.
4. For each fallacy found, explain specifically HOW the argument commits that fallacy — quote the relevant portion and explain the logical error in plain language.
5. If the argument is actually well-reasoned, say so! A Fair Play means the reasoning is sound even if someone might disagree with the conclusion.
6. Consider whether multiple fallacies are working together (stacking) — this affects severity.

${SEVERITY_RULES}
${RULING_TERMS}

Available fallacy types: ${FALLACY_TYPES.join(", ")}
For fair play, use type: "fairPlay"

Return ONLY a valid JSON object with this structure:
{
  "severity": "green" | "yellow" | "red",
  "summary": "A 1-2 sentence overall assessment of the argument's logical quality",
  "fallacies": [
    {
      "type": "exactFallacyTypeFromList",
      "ruling": "SOCCER_TERM",
      "analysis": "Detailed 2-4 sentence explanation of how this specific fallacy appears in the text. Quote the relevant portion and explain why it's fallacious.",
      "quotedText": "The specific phrase or sentence from the input that commits this fallacy"
    }
  ],
  "tweetReply": "A punchy X/Twitter reply (max 260 chars). See REPLY VOICE GUIDE below.",
  "bskyReply": "A punchy Bluesky reply (max 280 chars). Same voice as tweetReply."
}

For fair play (no fallacies), return:
{
  "severity": "green",
  "summary": "Assessment of why the reasoning is sound",
  "fallacies": [
    {
      "type": "fairPlay",
      "ruling": "FAIR PLAY",
      "analysis": "Explanation of what makes this argument well-reasoned — e.g. it cites evidence, acknowledges limitations, uses valid logical structure.",
      "quotedText": ""
    }
  ],
  "tweetReply": "A punchy X/Twitter reply (max 260 chars). See REPLY VOICE GUIDE below.",
  "bskyReply": "A punchy Bluesky reply (max 280 chars). Same voice as tweetReply."
}

REPLY VOICE GUIDE (for tweetReply and bskyReply):
You are a sharp, dry, witty referee — not a bot, not a customer service rep. Think Jon Stewart's writers room meets a soccer commentator.

Rules:
- NEVER open with "Hi [name]" or "Hey" or any greeting. Jump straight in.
- NEVER say "Fallacy Flag analyzed this" or "we found" — you ARE the ref, not a narrator describing the ref.
- Lead with the sharpest observation, not the label. The fallacy name comes second.
- Use analogies and metaphors that land in one line. Examples of the voice to emulate:
  "That's not a logical argument — it's a conspiracy theory formatted as a timeline."
  "Knocking down a scarecrow isn't the same as winning a fight."
  "Answering a different question very confidently is still not answering the question."
  "When you can't argue the numbers, argue the feelings."
- For fair play: Be genuinely impressed but not gushing. "Data on both sides, named sources, and zero straw men. This is how it's done." NOT "*Happy dance* GOOOAL!"
- End with the card color emoji + "| @FallacyFlagHQ" (for tweets) or "| fallacyflag.com" (for bsky).
- Keep it UNDER 260 chars for tweets, UNDER 280 chars for bsky. Every character counts — be ruthless with edits.
- No hashtags in the reply. The wit IS the hook.

Be thorough but fair. Identifying a fallacy does NOT mean the conclusion is wrong — it means the reasoning path has a flaw. And awarding Fair Play does NOT mean endorsing the conclusion — it means the argument is logically sound.`;
}

export default async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await req.json();
    const { text, image, imageType, admin } = body;
    const isAdmin = admin === true;

    // Log source for usage tracking
    console.log(`[analyze] source=${isAdmin ? "admin" : "visitor"} ts=${new Date().toISOString()}`);

    // Rate limit by IP — skip for admin
    if (!isAdmin) {
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-nf-client-connection-ip")
        || "unknown";
      if (isRateLimited(clientIp)) {
        return new Response(JSON.stringify({ error: "You've reached the analysis limit. Please try again in a bit — the ref needs a breather too." }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Retry-After": "3600" }
        });
      }
    }
    const hasImage = image && imageType;
    if ((!text || text.trim().length < 10) && !hasImage) {
      return new Response(JSON.stringify({ error: "Text too short. Please provide a substantive argument to analyze." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Cap input length to avoid excessive API costs
    const trimmedText = text ? text.slice(0, 3000) : "";

    // Check cache first — same text always gets the same analysis
    // (skip cache for image submissions since image data isn't reliably hashable)
    const cacheKey = !hasImage ? getCacheKey(trimmedText, false) : null;
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) {
        console.log(`[analyze] cache hit`);
        return new Response(JSON.stringify(cached), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // Build message content — use vision blocks when image is present
    const prompt = buildAnalysisPrompt(trimmedText, hasImage);
    let messageContent;
    if (hasImage) {
      messageContent = [
        { type: "image", source: { type: "base64", media_type: imageType, data: image } },
        { type: "text", text: prompt }
      ];
    } else {
      messageContent = prompt;
    }

    const client = new Anthropic({ apiKey });

    // Retry logic for transient errors (529 overloaded, 5xx server errors)
    let response;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2500,
          temperature: 0,
          messages: [{ role: "user", content: messageContent }]
        });
        break; // success — exit retry loop
      } catch (apiErr) {
        const status = apiErr?.status || apiErr?.statusCode;
        const isRetryable = status === 529 || status === 503 || status === 500;
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          const delay = (attempt + 1) * 2000; // 2s, 4s backoff
          console.log(`[analyze] retry ${attempt + 1}/${MAX_RETRIES} after ${status}, waiting ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw apiErr; // non-retryable or exhausted retries
      }
    }

    const responseText = response.content[0].text.trim();
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

    // Cache the result so identical text always gets the same call
    if (cacheKey) setCache(cacheKey, analysis);

    return new Response(JSON.stringify(analysis), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Analysis failed: " + err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};

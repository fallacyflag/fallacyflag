import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token"
      }
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const token = req.headers.get("X-Admin-Token");
  if (token !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const card = await req.json();

    if (!card.quote || !card.speaker || !card.severity) {
      return new Response(JSON.stringify({ error: "Missing required fields: quote, speaker, severity" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const page = card.page || "main";
    delete card.page;
    const storeKey = page === "potus" ? "potus-analyses" : "main-analyses";

    const store = getStore({ name: "analyses", consistency: "strong" });
    const raw = await store.get(storeKey);
    const analyses = raw ? JSON.parse(raw) : [];

    if (!card.id) {
      const maxId = analyses.reduce((max, a) => Math.max(max, a.id || 0), 5000);
      card.id = maxId + 1;
    }

    // Auto-add date field if not present (for chronological sorting)
    if (!card.date) {
      card.date = new Date().toISOString().slice(0, 10);
    }

    // Deduplicate by id before adding
    const deduped = analyses.filter(a => a.id !== card.id);
    deduped.unshift(card);
    const trimmed = deduped.slice(0, 60);
    await store.set(storeKey, JSON.stringify(trimmed));

    return new Response(JSON.stringify({
      success: true,
      id: card.id,
      total: trimmed.length,
      page: page
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/api/save-analysis"
};

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

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    const token = req.headers.get("X-Admin-Token");
    if (token !== adminToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  try {
    const { id, page } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing required field: id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const storeKey = page === "potus" ? "potus-analyses" : "main-analyses";
    const store = getStore({ name: "analyses", consistency: "strong" });
    const raw = await store.get(storeKey);
    const analyses = raw ? JSON.parse(raw) : [];

    const before = analyses.length;
    const filtered = analyses.filter(a => a.id !== id);
    const removed = before - filtered.length;

    if (removed === 0) {
      return new Response(JSON.stringify({ error: "Analysis not found", id }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    await store.set(storeKey, JSON.stringify(filtered));

    return new Response(JSON.stringify({ success: true, removed, remaining: filtered.length }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

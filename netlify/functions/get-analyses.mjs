import { getStore } from "@netlify/blobs";

export default async (req) => {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "main";

    const store = getStore({ name: "analyses", consistency: "strong" });

    let data;
    try {
          const raw = await store.get(type === "potus" ? "potus-analyses" : "main-analyses");
          data = raw ? JSON.parse(raw) : [];
    } catch (e) {
          data = [];
    }

    return new Response(JSON.stringify(data), {
          headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "public, max-age=60"
          }
    });
};

export const config = {
    path: "/api/get-analyses"
};

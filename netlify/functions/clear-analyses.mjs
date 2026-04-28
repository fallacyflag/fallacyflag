import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "analyses", consistency: "strong" });

  await Promise.all([
    store.set("main-analyses", JSON.stringify([])),
    store.set("potus-analyses", JSON.stringify([]))
  ]);

  return new Response(JSON.stringify({ cleared: true, main: 0, potus: 0 }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};

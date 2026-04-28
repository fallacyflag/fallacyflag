import Anthropic from "@anthropic-ai/sdk";

export default async (req) => {
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
    const { text, fallacies, severity, admin } = await req.json();
    const isAdmin = admin === true;
    console.log(`[rewrite] source=${isAdmin ? "admin" : "visitor"} ts=${new Date().toISOString()}`);

    if (!text || !fallacies) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const trimmedText = text.slice(0, 3000);

    const prompt = `You are a rhetoric coach helping someone make a stronger, more logically sound argument. You are NOT taking a political side — you are improving the logical structure of the argument regardless of its conclusion.

A user submitted this argument, and it was flagged for logical fallacies:

=== ORIGINAL ARGUMENT ===
${trimmedText}
=== END ARGUMENT ===

=== FALLACIES FOUND ===
${fallacies}
=== END FALLACIES ===

Severity: ${severity === "red" ? "Red Card (serious logical flaws)" : "Yellow Card (common rhetorical shortcuts)"}

Your job:
1. Rewrite the argument so it makes the SAME core point but without the logical fallacies.
2. Keep the same general position/conclusion — don't flip the argument. Strengthen it.
3. Replace emotional manipulation with evidence-based reasoning.
4. Replace false dilemmas with nuanced framing.
5. Replace ad hominem attacks with substantive critiques.
6. Replace straw men with accurate representations of opposing views.
7. Keep the tone accessible and conversational — don't make it sound like an academic paper.

Return ONLY a valid JSON object:
{
  "rewrite": "The rewritten, logically stronger version of the argument. 2-4 sentences.",
  "explanation": "A brief 1-2 sentence note on what changed and why it's stronger."
}`;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });

    const responseText = response.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Rewrite failed: " + err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};

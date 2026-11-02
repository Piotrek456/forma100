import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

const MODELS = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929"];

function extractJson(text: string) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!Netlify.env.get("ANTHROPIC_BASE_URL") && !Netlify.env.get("ANTHROPIC_API_KEY")) {
    return Response.json({ error: "AI niedostępne", code: "server" }, { status: 503 });
  }
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json", code: "server" }, { status: 400 }); }
  const prompt = String(body?.prompt || "").slice(0, 4000);
  const image = typeof body?.image === "string" ? body.image : null;
  if (!prompt) return Response.json({ error: "no prompt", code: "server" }, { status: 400 });
  if (image && image.length > 3_000_000) return Response.json({ error: "too big", code: "too_big" }, { status: 413 });

  const content: any[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  content.push({ type: "text", text: prompt + "\nOdpowiedz wyłącznie obiektem JSON, bez żadnego innego tekstu." });

  const anthropic = new Anthropic();
  let lastErr: any = null;
  for (const model of MODELS) {
    try {
      const msg = await anthropic.messages.create({ model, max_tokens: 1200, messages: [{ role: "user", content }] });
      const text = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const data = extractJson(text);
      if (!data || typeof data !== "object") return Response.json({ error: "invalid", code: "invalid_json" }, { status: 200 });
      return Response.json(data);
    } catch (e: any) {
      lastErr = e;
      const st = e?.status;
      if (st === 404 || st === 400 && /model/i.test(String(e?.message))) continue;
      if (st === 429) return Response.json({ error: "rate", code: "rate_limited" }, { status: 429 });
      break;
    }
  }
  console.error("kcal error", lastErr?.status, lastErr?.message);
  return Response.json({ error: "upstream", code: "server" }, { status: 502 });
};

export const config: Config = {
  path: "/api/kcal",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

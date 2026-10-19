import page from "./ui.html";

export interface Env {
  AI: { run(model: string, inputs: Record<string, unknown>): Promise<any> };
}

// Open-weight model served by Cloudflare Workers AI (free tier, $0).
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_INPUT = 8000;

const SYSTEM = `You are FitKit, a precise career assistant. You help a candidate tailor their application to a specific job posting.

RULES:
- Be truthful: NEVER invent jobs, skills, degrees, or credentials that are not in the CV.
- Mirror the posting's keywords and language when rewriting bullets.
- Keep the cover letter under 250 words, 3-4 short paragraphs.
- Respond with JSON ONLY. No markdown fences, no commentary, no extra text.

EXACT JSON SHAPE:
{
  "match": {
    "score": <integer 0-100: overall fit of CV to posting>,
    "matched": ["<skill from the posting clearly present in the CV>", ... up to 8],
    "missing": ["<key skill or experience the posting asks for but the CV lacks>", ... up to 8],
    "summary": "<2-3 sentence honest assessment of fit>"
  },
  "bullets": ["<rewritten CV bullet>", ... 5 to 7 bullets, quantified with numbers where the CV supports it],
  "coverLetter": "<3-4 short paragraphs: hook tied to the role; 2-3 proof points from the CV mapped to posting needs; warm close with a call to action>"
}`;

function buildPrompt(jobText: string, cvText: string): string {
  return `JOB POSTING:\n${jobText}\n\nCANDIDATE CV:\n${cvText}\n\nProduce the tailored application kit as JSON.`;
}

function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no-json");
  return JSON.parse(text.slice(start, end + 1));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      try {
        const body: any = await request.json().catch(() => ({}));
        const jobText = String(body.jobText || "").slice(0, MAX_INPUT).trim();
        const cvText = String(body.cvText || "").slice(0, MAX_INPUT).trim();

        if (jobText.length < 50) {
          return json({ error: "Please paste a fuller job posting (at least 50 characters)." }, 400);
        }
        if (cvText.length < 50) {
          return json({ error: "Please paste more of your CV (at least 50 characters)." }, 400);
        }

        const out: any = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildPrompt(jobText, cvText) },
          ],
          max_tokens: 2200,
        });

        const text = String(out.response || "");
        let kit: any;
        try {
          kit = extractJson(text);
        } catch {
          return json({ error: "The AI returned an unexpected format. Please try again." }, 502);
        }

        if (!kit.match || !Array.isArray(kit.bullets) || typeof kit.coverLetter !== "string") {
          return json({ error: "The AI returned an incomplete kit. Please try again." }, 502);
        }

        return json({ kit, model: MODEL });
      } catch (e) {
        return json({ error: "Analysis failed. Please try again in a moment." }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

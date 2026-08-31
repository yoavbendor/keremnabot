/**
 * KeremNaBot relay -- a stateless Cloudflare Worker.
 *
 * Forwards a BYOK chat request to the Anthropic Messages API and streams
 * back plain text deltas. Never logs the caller's API key or message
 * content. Locks CORS to the deployed frontend origin and validates the
 * request shape so this can't be repurposed as an open Anthropic proxy.
 */

const ALLOWED_ORIGIN = "https://keremnabot.pages.dev"; // TODO: set to your real deployed origin
const ANTHROPIC_VERSION = "2023-06-01";
const ALLOWED_MODELS = new Set(["claude-haiku-4-5", "claude-sonnet-5"]);
const MAX_MESSAGES = 40; // guardrail against runaway sessions
const MAX_SYSTEM_CHARS = 200_000; // generous ceiling well above our real KB size

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function badRequest(message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return badRequest("Only POST is supported", origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body", origin);
    }

    const { apiKey, model, systemStatic, systemDynamic, messages } = body;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("sk-ant-")) {
      return badRequest("Missing or malformed apiKey", origin);
    }
    if (!ALLOWED_MODELS.has(model)) {
      return badRequest("Unsupported model", origin);
    }
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return badRequest("Invalid messages array", origin);
    }
    if (typeof systemStatic !== "string" || typeof systemDynamic !== "string") {
      return badRequest("Missing system prompt fields", origin);
    }
    // Require the expected KB-grounded shape -- guards against this relay
    // being used as a generic Anthropic proxy for unrelated traffic.
    if (!systemStatic.includes("KeremNaBot") || systemStatic.length > MAX_SYSTEM_CHARS) {
      return badRequest("System prompt does not match expected shape", origin);
    }

    const anthropicPayload = {
      model,
      max_tokens: 1024,
      stream: true,
      system: [
        { type: "text", text: systemStatic, cache_control: { type: "ephemeral" } },
        { type: "text", text: systemDynamic },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(anthropicPayload),
      });
    } catch (err) {
      return badRequest(`Upstream request failed: ${err.message}`, origin);
    }

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return new Response(errText || "Upstream error", {
        status: upstream.status,
        headers: corsHeaders(origin),
      });
    }

    // Anthropic streams Server-Sent Events; extract just the text deltas and
    // pass those straight through as plain text chunks.
    const textStream = upstream.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(sseTextDeltaTransform())
      .pipeThrough(new TextEncoderStream());

    return new Response(textStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
    });
  },
};

function sseTextDeltaTransform() {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            controller.enqueue(event.delta.text);
          }
        } catch {
          // Ignore malformed SSE lines rather than breaking the stream.
        }
      }
    },
  });
}

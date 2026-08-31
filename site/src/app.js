// KeremNaBot frontend logic.
//
// Retrieval design (see plan / commit history for the reasoning):
// - kb_context.json (graph + ontology) is small enough to send in full, as a
//   compact plain-text block, on every turn (cached server-side via
//   `cache_control` since it's identical every time within a session).
// - excerpts.json holds verbatim, exact-string-matched quotes from the 26
//   source documents, each pre-embedded offline with bge-small-en-v1.5. At
//   chat time we embed the user's question with the SAME model, running
//   client-side via transformers.js/onnxruntime-web (WASM) against the
//   model files committed to this repo -- no network call to any embedding
//   API, and no re-implementation risk versus the offline Python pipeline
//   used to build excerpts.json in the first place.
// - The embedding step only RANKS which pre-verified quotes are most
//   relevant to the question. It never generates new text, so it cannot be
//   a source of hallucination -- every excerpt shown to the user (and fed
//   to the model) is guaranteed to be real, verbatim source text.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js";

env.allowRemoteModels = false;
env.localModelPath = "/model/";
env.backends.onnx.wasm.numThreads = 1;

const RELAY_URL = "https://keremnabot-relay.YOUR_SUBDOMAIN.workers.dev"; // TODO: set after Worker deploy
const MODEL_ID = "bge-small-en-v1.5";
const TOP_K_EXCERPTS = 4;

const state = {
  kbContext: null,
  excerpts: [],
  embedder: null,
  history: [], // [{role, content}]
};

const el = (id) => document.getElementById(id);

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function buildGraphContextText(kb) {
  const lines = ["ENTITIES:"];
  for (const e of kb.entities) lines.push(`- ${e.name} (${e.type})`);
  lines.push("", "RELATIONSHIPS:");
  for (const r of kb.relationships) lines.push(`- ${r.source} --[${r.type}]--> ${r.target}`);
  lines.push("", "ONTOLOGY CLASSES:");
  for (const c of kb.classes) lines.push(`- ${c.name}${c.parent ? ` (subclass of ${c.parent})` : ""}: ${c.comment || ""}`);
  lines.push("", "ONTOLOGY PROPERTIES:");
  for (const p of kb.properties) lines.push(`- ${p.name} (${p.domain?.join("/")} -> ${p.range?.join("/")}): ${p.comment || ""}`);
  return lines.join("\n");
}

const SYSTEM_PREAMBLE = `You are KeremNaBot, a research assistant answering questions using ONLY the
knowledge graph, ontology, and quoted excerpts provided below. These excerpts
are verbatim, exact-string-matched quotes from real source documents -- treat
them as ground truth, and do not alter or paraphrase a quote when citing it.

STRICT RULES:
1. Only state facts that are directly supported by the graph, ontology, or the
   provided excerpts below.
2. If the user asks something the provided material does not cover, say
   "I'm not sure" or "I don't know based on what I have" -- do NOT guess,
   speculate, or invent a plausible-sounding answer or quote.
3. When you use an excerpt, cite its source document by title.
4. Prefer engaging, clear prose over dry lists, but never at the cost of
   accuracy -- an honest "I don't know" is always better than a fabricated
   detail or misattributed quote.`;

async function loadKB() {
  const [kb, excerpts] = await Promise.all([
    fetch("kb_context.json").then((r) => r.json()),
    fetch("excerpts.json").then((r) => r.json()),
  ]);
  state.kbContext = kb;
  state.excerpts = excerpts;
  state.graphContextText = buildGraphContextText(kb);

  const docsSeen = new Set();
  const list = el("docs-list");
  for (const e of excerpts) {
    if (docsSeen.has(e.doc_title)) continue;
    docsSeen.add(e.doc_title);
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = e.doc_url;
    a.textContent = e.doc_title.replace(/\.docx$/, "");
    a.target = "_blank";
    a.rel = "noopener";
    li.appendChild(a);
    list.appendChild(li);
  }

  el("kb-status").textContent =
    `Knowledge base loaded: ${kb.entities.length} entities, ${kb.relationships.length} relationships, ` +
    `${excerpts.length} sourced excerpts from ${docsSeen.size} documents.`;
}

async function ensureEmbedder() {
  if (state.embedder) return state.embedder;
  el("kb-status").textContent = "Preparing local embedding model (one-time download, ~65MB)…";
  state.embedder = await pipeline("feature-extraction", MODEL_ID, { dtype: "fp32" });
  el("kb-status").textContent = "Ready.";
  return state.embedder;
}

async function retrieveExcerpts(question) {
  const embedder = await ensureEmbedder();
  const output = await embedder(question, { pooling: "mean", normalize: true });
  const qVec = Array.from(output.data);

  const scored = state.excerpts.map((e) => ({ e, score: cosineSim(qVec, e.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_K_EXCERPTS).map((s) => s.e);
}

function buildExcerptBlock(excerpts) {
  if (excerpts.length === 0) return "(No closely matching excerpts found for this question.)";
  return excerpts
    .map((e, i) => `[${i + 1}] Source: "${e.doc_title}" (entity: ${e.entity})\n"${e.excerpt}"`)
    .join("\n\n");
}

function appendMessage(role, text, citations) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  if (citations && citations.length) {
    const cdiv = document.createElement("div");
    cdiv.className = "citations";
    cdiv.innerHTML = "Sources: " + citations
      .map((c) => `<a href="${c.doc_url}" target="_blank" rel="noopener">${c.doc_title.replace(/\.docx$/, "")}</a>`)
      .join(", ");
    div.appendChild(cdiv);
  }
  el("chat-log").appendChild(div);
  el("chat-log").scrollTop = el("chat-log").scrollHeight;
  return div;
}

async function sendMessage(question) {
  const apiKey = el("api-key").value.trim();
  const model = el("model-select").value;
  if (!apiKey) {
    alert("Enter your Anthropic API key first.");
    return;
  }
  localStorage.setItem("keremnabot_key", apiKey);
  localStorage.setItem("keremnabot_model", model);

  appendMessage("user", question);
  state.history.push({ role: "user", content: question });

  const excerpts = await retrieveExcerpts(question);
  // Split into a static block (identical every turn -> cacheable server-side
  // via cache_control) and a dynamic block (changes per question, the
  // retrieved excerpts -> not cacheable, but small).
  const systemStatic = SYSTEM_PREAMBLE + "\n\nGRAPH + ONTOLOGY:\n" + state.graphContextText;
  const systemDynamic = "RELEVANT EXCERPTS FOR THIS QUESTION:\n" + buildExcerptBlock(excerpts);

  const botDiv = appendMessage("bot", "…");
  let fullText = "";

  try {
    const resp = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model,
        systemStatic,
        systemDynamic,
        messages: state.history,
      }),
    });
    if (!resp.ok || !resp.body) throw new Error(`Relay error: ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    botDiv.textContent = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      botDiv.textContent = fullText;
      el("chat-log").scrollTop = el("chat-log").scrollHeight;
    }
  } catch (err) {
    fullText = `Error talking to the relay: ${err.message}`;
    botDiv.textContent = fullText;
  }

  if (excerpts.length) {
    const cdiv = document.createElement("div");
    cdiv.className = "citations";
    cdiv.innerHTML = "Sources consulted: " + excerpts
      .map((e) => `<a href="${e.doc_url}" target="_blank" rel="noopener">${e.doc_title.replace(/\.docx$/, "")}</a>`)
      .join(", ");
    botDiv.appendChild(cdiv);
  }

  state.history.push({ role: "assistant", content: fullText });
}

function init() {
  const savedKey = localStorage.getItem("keremnabot_key");
  const savedModel = localStorage.getItem("keremnabot_model");
  if (savedKey) el("api-key").value = savedKey;
  if (savedModel) el("model-select").value = savedModel;

  loadKB().then(() => {
    el("chat-input").disabled = false;
    el("chat-send").disabled = false;
  });

  el("chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = el("chat-input");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    sendMessage(q);
  });
}

init();

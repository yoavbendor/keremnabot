# KeremNaBot KB — toy MCP server

A minimal, read-only [MCP](https://modelcontextprotocol.io) server exposing
the Hebrew evidence graph (`../heb-graph/graph.json`) as tools any
MCP-capable chat client can call directly — no API key ever passes through
this app, no chat UI to maintain here. See the repo's top-level discussion
for why (the app stays "dumb," the user's own chat client does the
reasoning against these tools with credentials it already has).

**Live**: `https://keremnabot-mcp-toy.keremnavot.workers.dev/mcp`

## Tools

- `search_entities(query, limit?)` — substring match (case-insensitive,
  Hebrew or English) against entity names. Returns each match's canonical
  `key` (needed by `get_entity`), type, and relationship count.
- `get_entity(key)` — full detail for one entity: type, and every
  relationship it appears in with the other endpoint's name and the
  source-document evidence ids backing it.
- `get_evidence_text(evidence_id)` — the real, verbatim source passage
  behind an evidence id from `get_entity` (or a plain-language fallback
  for a `doc:`-scoped, document-level id, which has no single passage).
  This is the actual grounding mechanism: `get_entity` alone only returns
  relation labels, so nothing stops a model from asserting a relationship
  exists without ever having read text that backs it. Calling this and
  quoting the result is what makes an answer checkable.

## Grounding: how this competes with hallucination and web search

We don't control the calling client's system prompt — only persuade it,
via two levers actually wired up:

- The server's `instructions` (see `SERVER_INSTRUCTIONS` in `src/index.ts`),
  surfaced to the model in the `initialize` response per the MCP spec —
  tells the model to prefer these tools over general knowledge/web search
  for this corpus, and to call `get_evidence_text` before stating a fact.
- Each tool's `description` reinforces the same thing locally at the point
  of use ("PREFER THIS over general knowledge...").

Neither is enforceable — a client can ignore both and hallucinate anyway.
This is a real trade against the original BYOK in-page chat design, where
we wrote the whole system prompt ourselves and could hard-require it.

## Architecture

Stateless — `@modelcontextprotocol/server`'s `McpServer`/`createMcpHandler`
directly, no Agents SDK, no Durable Objects, no auth (the data is already
public: 26 published human-rights reports and their extracted graph). The
Worker fetches `heb-graph/graph.json` from this repo's `raw.githubusercontent.com`
URL on cold start and caches it in the isolate across warm invocations.

## Add to an MCP client

Claude Desktop / Claude Code / any MCP host that supports remote servers:
point it at `https://keremnabot-mcp-toy.keremnavot.workers.dev/mcp`.

## Run locally

```bash
npm install
npx wrangler dev
# connect a client (or curl) to http://localhost:8787/mcp
```

## Deploy

```bash
npm install
npx wrangler login   # or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
npx wrangler deploy
```

## What "toy" means here, and what's next

Deliberately minimal to prove the architecture end-to-end before investing
in the full tool surface:

- **Search is substring-only.** No fuzzy matching, no relevance ranking
  beyond "most-connected first," no semantic/embedding search. A query
  like "water deprivation" won't find `Parched` unless that exact phrase
  appears in an entity name.
- **Hebrew only.** `KeremNavotEng/` has no graph built yet; once it does,
  this server should either serve both or a second instance should.
- **No ontology tools.** `heb-graph/ontology.json` (22 classes, 80
  properties) isn't exposed at all yet — class-based browsing/filtering
  is a reasonable next tool.
- **`graph.json` is fetched whole on cold start (~6MB).** Fine for one
  Worker instance's memory, but as a design point: a "real" version might
  index into R2/KV instead of holding the whole graph in memory, if the
  corpus grows a lot larger.

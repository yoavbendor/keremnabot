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
  source-document evidence chunk ids backing it.

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
- **No excerpt/quote lookup tool yet.** `get_entity`'s evidence field is
  just chunk ids (`doc-slug#0004`), not the actual quoted text — a real
  `get_evidence_text(chunk_id)` tool (or embedding chunk text directly)
  is the natural next addition.
- **Hebrew only.** `KeremNavotEng/` has no graph built yet; once it does,
  this server should either serve both or a second instance should.
- **No ontology tools.** `heb-graph/ontology.json` (22 classes, 80
  properties) isn't exposed at all yet — class-based browsing/filtering
  is a reasonable next tool.
- **`graph.json` is fetched whole on cold start (~6MB).** Fine for one
  Worker instance's memory, but as a design point: a "real" version might
  index into R2/KV instead of holding the whole graph in memory, if the
  corpus grows a lot larger.

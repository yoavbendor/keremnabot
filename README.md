# KeremNaBot

A public, BYOK (bring-your-own-key) demo chatbot answering from a knowledge
graph + ontology, grounded in verbatim excerpts from the 26 translated
source documents in `KeremNavotEng/` (never LLM-invented quotes).

This repo is a **worked example** of
[`nanonto`](https://github.com/yoavbendor/nanonto), an evidence-linked
knowledge-graph pipeline: chunk → extract → verify → merge → dedup →
ontology, with every entity and relation traceable back to the exact
passage that produced it. `nanonto` is the reusable engine; this repo is
one corpus (a public human-rights research archive) plus the frontend/relay
needed to turn its output into a chatbot. Point the same pipeline at your
own `.docx`/`.md` corpus to reuse it for anything else — `nanonto` has no
dependency on this repo or its data.

## Architecture

- `KeremNavotEng/` — the 26 source `.docx` documents (public human-rights
  research reports), the input corpus.
- `nanonto` (fetched at build time, not vendored here) — builds the
  evidence graph and ontology from `KeremNavotEng/`, and produces the
  `kb_context.json`/`excerpts.json` static assets consumed by the frontend.
  See `.github/workflows/deploy.yml`.
- `site/` — static frontend (no build step). Runs the `bge-small-en-v1.5`
  embedding model client-side (WASM, via transformers.js) against the
  model files `nanonto` ships, to semantically rank which pre-verified
  excerpts are relevant to each question.
- `worker/` — a stateless Cloudflare Worker that relays chat requests to
  the Anthropic API using each visitor's own API key. Never logs the key or
  message content.

## One-time setup (manual, not automatable from here)

1. Create a free Cloudflare account, then an API token with Pages + Workers
   edit permissions: https://dash.cloudflare.com/profile/api-tokens
2. Add repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and
   `ANTHROPIC_API_KEY` (used only at build time to generate the graph/
   ontology — Settings → Secrets and variables → Actions). Omitting
   `ANTHROPIC_API_KEY` is fine; the deploy step then skips the rebuild and
   ships the site with whatever `site/public/` already holds.
3. First deploy will fail to reference itself correctly (chicken-and-egg):
   after the first successful run, note the deployed Pages URL
   (`https://keremnabot.pages.dev` or similar) and the Worker URL
   (`https://keremnabot-relay.<your-subdomain>.workers.dev`), then:
   - Update `ALLOWED_ORIGIN` in `worker/worker.js` to the real Pages URL.
   - Update `RELAY_URL` in `site/src/app.js` to the real Worker URL.
   - Push again to redeploy both with the correct URLs wired together.

## Local testing before a public demo

- `cd worker && npx wrangler dev` to run the relay locally with a real
  (low-budget, scoped) test API key.
- Serve `site/` with any static file server pointed at the local Worker URL.
- Ask a few sample questions and confirm answers read as grounded prose
  citing real excerpts, not either dry graph triples or ungrounded claims.
- Confirm the model asks are answered with "I'm not sure" rather than a
  guess when the graph/excerpts genuinely don't cover the question.

## License

Code in this repo (MIT, see `LICENSE`) is separate from the content of
`KeremNavotEng/`, which is third-party published human-rights research
(not our work) — see the individual documents for their own attribution
and terms.

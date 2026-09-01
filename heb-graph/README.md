# Hebrew evidence graph (KeremNavotHeb)

Knowledge graph + ontology built from `KeremNavotHeb/`'s 26 real Hebrew
`.md` documents, using [nanonto](https://github.com/yoavbendor/nanonto)'s
pipeline (`kg_pipeline/build_evidence_graph.py` -> `build_ontology.py` ->
`entity_resolution.py`). Committed here rather than in `nanonto`, since
this data is corpus-specific to this demo, not general pipeline code.

Run manually on 2026-08-31 (extraction, ontology, first dedup pass) and
2026-09-01 (second dedup pass), against the actual uploaded corpus (not a
fixture). Served live by `mcp-server/` (an MCP server, see its README) and
by the static graph/ontology explorer published via GitHub Pages
(`.github/workflows/pages.yml`) — not wired into `.github/workflows/deploy.yml`
(the BYOK chat site under `site/`) yet.

## What's here

| File | What |
|---|---|
| `graph.json` | The merged, dedup'd evidence graph — entities, relationships, each with `evidence` chunk-ids tracing back to exact source spans. |
| `ontology.json` | Induced class/property ontology, grounded against `graph.json` (every class lists its verified member entities). |
| `chunks.json` | The evidence store — every chunk's exact `(doc_id, start, end)` span, needed to resolve `evidence` ids back to real quoted text. |
| `doc_level.json` | Document-scope facts (authorship, publication date, etc.) from the one-call-per-document pass, kept separate from chunk-level support counts. |
| `raw_extractions.jsonl` | Raw per-chunk model output before verification — lets you re-run `--verify-only` for free if the verification/merge logic ever changes. |
| `alias_candidates_audit.tsv` | Every entity-pair the dedup pass considered, with its signal, score, and SAME/DIFFERENT verdict — including the ones it rejected. |
| `stats.json` | The extraction run's own stats block (see below). |

## Commands run

```bash
python3 kg_pipeline/build_evidence_graph.py \
    --corpus KeremNavotHeb --glob '*.md' \
    --model claude-haiku-4-5 --out heb_full_out

python3 kg_pipeline/build_ontology.py \
    --graph heb_full_out/graph.json --out heb_full_out/ontology.json \
    --model claude-haiku-4-5

python3 kg_pipeline/entity_resolution.py \
    --dir heb_full_out --language he --signals trigram neighbor \
    --model claude-haiku-4-5 --max-candidates 300 --apply
```

`--language he` disables the `embedding` dedup signal (the local
`bge-small-en-v1.5` model has no Hebrew tokens — see `entity_resolution.py`'s
module docstring); `trigram` and `neighbor` are language-agnostic and did
the actual dedup work here.

## Results

**Extraction** (`build_evidence_graph.py`):
- 26 docs -> 1451 chunks, **0 tiling failures, 0 parse failures**
- 21,260 entity mentions accepted / 719 rejected (3.27% rejection)
- 9,610 relations accepted / 970 rejected (9.17% rejection)
- 59 cross-boundary relations (0.61%)
- merged into 8,855 nodes / 9,168 edges before dedup
- cost: **1,480 calls, $5.56**

**Ontology** (`build_ontology.py`):
- 22 classes, 80 properties
- class coverage 100% (every class has ≥1 verified member — no empty/invented abstractions)
- entity coverage 99.35% (58 entities left unclassified)
- 0 invented class assignments, 0 invented predicate mappings
- domain/range violation rate is high (77.7% of 530 checked) — per this
  project's own earlier finding on the English corpus, most of that is
  **not** a real contradiction but the hierarchy-subsumption false-positive
  `recheck_domain_range.py` exists to filter (a property assigned via a
  parent class looks like a violation at the child class until you walk
  the hierarchy). Worth running `recheck_domain_range.py --arm
  /path/to/heb-graph` (nanonto's `--arm` flag there just takes a
  directory path, despite the name) before trusting that number at face
  value.
- cost: 90 calls, $0.41

**Entity resolution / dedup** (`entity_resolution.py --language he`), run twice:
- Pass 1: 300 candidates verified, 103 SAME / 197 DIFFERENT, 98 merges applied
  → 8,855 → 8,757 entities.
- Pass 2 (after fixing a real bug — see below): 300 more candidates
  (already-audited pairs excluded), 81 SAME / 219 DIFFERENT, 81 merges applied
  → 8,757 → **8,676 entities, 9,132 relationships**. Cost: $0.25.
- The dedup pass first failed silently for about an hour: the API key in use
  was scoped to multiple workspaces, so every call was rejected with "
  anthropic-workspace-id is required..." and retried 5 times before moving
  on — burning wall-clock time at **$0 actual cost** (every call failed
  before being billed). Fixed in `nanonto` by adding
  `ANTHROPIC_WORKSPACE_ID` env var support to `llm_client.get_client()`.
- `alias_candidates_audit.tsv` accumulates across both passes — every
  candidate either run has considered, accepted or not, is in there.
- Real fragmentation was still present after pass 1 (found by querying the
  live MCP server, not by inspecting the file directly): 15+ separate
  entities for "settlers" alone (מתנחלימ, המתנחלימ, מתנחלימ ישראלימ, ...)
  from OCR-artifact spelling variants and definite-article prefixes never
  merged. Pass 2 cut into this but candidates are capped at 300/run by
  design (cost control) — a further pass would likely find more.

**Total: ~$6.25** across extraction + ontology + both dedup passes.

## Known rough edges (spot-checked, not fixed)

- A few OCR-flavored spelling artifacts survive from the original
  PDF-to-markdown conversion (e.g. final-mem/plain-mem confusion:
  `מתנחלימ` instead of `מתנחלים` in at least one source file). These are
  in the source `.md` files, not introduced by the pipeline — the
  extraction/verification gate correctly preserves whatever the source
  text actually says.
- The model occasionally mixes English into relation types or targets
  (e.g. `בצלמ --[located_in]--> israel`) instead of staying fully
  Hebrew. Doesn't break anything downstream (predicates are just strings),
  but worth knowing before assuming everything is monolingual.

## Not yet done

- **Not wired into the live site.** `keremnabot`'s frontend reads
  `kb_context.json` + `excerpts.json` (built by
  `nanonto`'s `build_kb_context.py` from a graph + ontology + docs
  directory) — that step hasn't been run against this Hebrew graph yet.
  Say the word and I'll run it and wire a Hebrew mode into `site/`.
- **No cross-language alignment against the English graph** — this graph
  hasn't been built yet either (`KeremNavotEng/` is the English corpus
  already in this repo). `align_entities.py` / `compare_graphs.py` are the
  tools for that once both exist.
- **`recheck_domain_range.py`** hasn't been run yet to separate real
  domain/range violations from hierarchy false-positives (see above).

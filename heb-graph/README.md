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
| `alias_candidates_audit.tsv` | Every entity-pair the dedup pass considered, with its signal, score, and SAME/DIFFERENT verdict — including the ones it rejected. Currently holds only the most recent (third) dedup pass's rows — passes 1 and 2's were lost to a bug, now fixed; see Results below. |
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
    --model claude-haiku-4-5 --max-candidates 300 --apply   # passes 1-2

python3 kg_pipeline/entity_resolution.py \
    --dir heb_full_out --language he \
    --signals trigram neighbor translate --translate-via-batch \
    --model claude-haiku-4-5 --translate-model claude-haiku-4-5 \
    --max-candidates 400 --apply                            # pass 3

python3 kg_pipeline/entity_resolution.py \
    --dir heb_full_out --language he \
    --signals trigram neighbor translate --translate-via-batch \
    --model claude-haiku-4-5 --translate-model claude-haiku-4-5 \
    --max-candidates 1200 --apply                           # pass 4

python3 kg_pipeline/entity_resolution.py \
    --dir heb_full_out --language he \
    --signals trigram neighbor translate --translate-via-batch \
    --model claude-haiku-4-5 --translate-model claude-haiku-4-5 \
    --max-candidates 2000 --apply                           # pass 5, after the
                                                              # containment-ranking fix
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

**Entity resolution / dedup** (`entity_resolution.py --language he`), run three times:
- Pass 1 (`--signals trigram neighbor`): 300 candidates verified, 103 SAME /
  197 DIFFERENT, 98 merges applied → 8,855 → 8,757 entities.
- Pass 2 (same signals, after fixing the workspace-id bug below): 300 more
  candidates, 81 SAME / 219 DIFFERENT, 81 merges applied → 8,757 → 8,676
  entities, 9,132 relationships. Cost: $0.25.
- Pass 3 (`--signals trigram neighbor translate --translate-via-batch`,
  `--max-candidates 400`): 400 candidates verified, 179 SAME / 221 DIFFERENT,
  156 merges applied → 8,676 → **8,520 entities, 9,077 relationships**. Cost:
  not captured exactly (truncated by a `tail -100` mistake on my end, same
  class of error as pass 2's originally-uncaptured cost) — 400 verification
  calls plus one batched translation submission over all 8,676 names, at
  Haiku rates, puts it in the same $0.25–0.50 range as pass 2.
  The `translate` signal earned its place: it caught real cross-language/
  paraphrase duplicates the other two signals structurally cannot (they only
  compare surface form or graph neighborhood) — `ישראל`/`Israel`,
  `צה"ל`/`צבא הגנה לישראל` (acronym vs. full name), `בצלם`/`BTSELEM`/`بتسيلم`
  (Hebrew/English/Arabic spellings unified), and the "settlers" cluster
  merging in `settlers` itself alongside its Hebrew spelling variants.
- Pass 4 (`--max-candidates 1200`, same signals): a background job died
  mid-run when this session's sandbox reset (killed a plain `nohup`
  process — not a pipeline bug); re-ran clean. 201 merges applied →
  8,520 → 8,319 entities, 9,053 relationships.
- Pass 5 (`--max-candidates 2000`, after the containment-ranking fix
  below): 137 merges applied → 8,319 → **8,182 entities, 8,967
  relationships**.
- **Total across all five: 673 merges, 8,855 → 8,182 entities.**
- **A third real bug, found via the GitHub Pages explorer**: a visitor
  spotted `הגדה המערבית` ("the West Bank") and `גדה המערבית` ("West
  Bank", same phrase minus the definite article) sitting as two separate
  large nodes after pass 3 — an obvious duplicate. Investigation
  (`nanonto` commit `58f42b8`) found the pair *was* a candidate at every
  `--trigram-expand` value tested (15 through 400) but scored only 0.688
  raw trigram-Jaccard — Jaccard punishes the length asymmetry from a
  dropped one-word prefix — so it lost every `--max-candidates` cut
  tried (400, 1200), buried under thousands of other same-corpus
  candidates that happened to score higher. Raising `--max-candidates`
  alone (pass 4, tried 1200) could not have fixed this; the bottleneck
  was ranking, not candidate-pool coverage or size. Fixed by scoring
  genuine substring-containment pairs at a floor score and exempting
  them from `--max-candidates` entirely, gated by a length-ratio check
  (`min_containment_ratio=0.6`) so it fires only for real prefix/suffix
  variants and not a short name incidentally buried in an unrelated long
  one (this corpus has 6,355 raw containment pairs, mostly legal-order
  titles that happen to mention a place name — the ratio gate cuts that
  to ~1,000, keeping the guaranteed-included set cheap). Verified fixed
  in pass 5: `הגדה המערבית`/`גדה המערבית` merged (support 639).
- **Known, deliberately unfixed**: `מדינת ישראל`/`המדינה` and
  `ממשלת ישראל`/`הממשלה` remain separate nodes. Unlike the West Bank
  pair, these aren't string-similar (Hebrew construct-state grammar
  changes the word form: `מדינה` → `מדינת`) and their neighbor-overlap
  Jaccard is ~0.005–0.1 (predicate+target tuples are too literal to
  match across differently-phrased sentences) — no signal here proposes
  them as candidates at any threshold tested. Catching them would need
  either a Hebrew-specific construct-state normalization rule (against
  this pipeline's own "language-agnostic signals" design) or a
  `--max-candidates` in the tens of thousands to brute-force in every
  low-scoring pair (~$10–20+ for one pass on this corpus alone) — not a
  good trade for a rehearsal corpus. Left as a documented limitation
  rather than chased.
- The dedup pass first failed silently for about an hour (before pass 2):
  the API key in use was scoped to multiple workspaces, so every call was
  rejected with "anthropic-workspace-id is required..." and retried 5 times
  before moving on — burning wall-clock time at **$0 actual cost** (every
  call failed before being billed). Fixed in `nanonto` by adding
  `ANTHROPIC_WORKSPACE_ID` env var support to `llm_client.get_client()`.
- **A second real bug, found after pass 3**: `alias_candidates_audit.tsv` was
  supposed to accumulate every candidate any run has ever considered, but
  the sync `--apply` code path always overwrote it with only the current
  run's own rows instead of appending — so pass 2 silently discarded pass
  1's audit trail, and pass 3 discarded pass 2's. **The graph itself is
  unaffected** (`load_audited_pairs()` correctly excluded already-checked
  pairs each time from the file that existed *before* each run started, and
  every merge that was ever applied is still in `graph.json`) — only the
  row-level record of *which* pairs were checked and rejected in passes 1
  and 2 is unrecoverable; the current file holds only pass 3's 400 rows.
  Fixed in `nanonto` (commit `1bd0a2e`) to load existing rows first, so this
  won't happen again from pass 4 onward.
- Real fragmentation was still present after pass 1 (found by querying the
  live MCP server, not by inspecting the file directly): 15+ separate
  entities for "settlers" alone. Passes 2 and 3 cut into this substantially,
  but candidates are capped at 300–400/run by design (cost control) — a
  further pass would likely still find more.

**Total: ~$6.5–6.75** across extraction + ontology + all three dedup passes.

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

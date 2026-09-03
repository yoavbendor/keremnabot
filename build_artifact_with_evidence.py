#!/usr/bin/env python3
"""Builds a self-contained Claude Artifact HTML for this repo's Hebrew graph,
reusing nanonto's explorer/build_artifact.py for the DATA/template splice but
supplying evidence from OUR OWN exact chunk-id provenance (graph.json's
per-entity `evidence` list resolved against chunks.json's real quoted body
text) instead of build_artifact.py's own --excerpts path, which expects
build_kb_context.py's separate name-matched sentence-harvest (a weaker,
different mechanism we never ran on this corpus and don't want to introduce
just for this second distribution channel -- keeps both the GitHub Pages
site and this Artifact grounded in the identical evidence data).

Usage:
    python3 build_artifact_with_evidence.py \
        --graph heb-graph/graph.json --ontology heb-graph/ontology.json \
        --chunks heb-graph/chunks.json --title "KeremNaBot Hebrew Graph" \
        --max-quotes-per-entity 6 --out artifact_out/explorer.html
"""
import argparse
import json
import sys
from pathlib import Path

NANONTO_EXPLORER = Path("/home/user/nanonto/kg_pipeline/explorer")
sys.path.insert(0, str(NANONTO_EXPLORER))
import build_artifact as ba  # noqa: E402


def truncate_around_mention(body: str, name: str, max_chars: int) -> str:
    """Full chunk bodies average ~1,660 chars; baking all of that per
    evidence reference, per entity, blew a first attempt at this past 39MB
    (16MB Artifact cap). Real quoted text still has to be verbatim, so this
    trims to a window centered on the entity's own name where it can find
    one, falling back to the start of the chunk -- never re-wording,
    only cutting, with an ellipsis marking a cut edge.
    """
    if len(body) <= max_chars:
        return body
    idx = body.find(name)
    if idx == -1:
        return body[:max_chars].rstrip() + "…"
    half = max_chars // 2
    start = max(0, idx - half)
    end = min(len(body), start + max_chars)
    start = max(0, end - max_chars)
    snippet = body[start:end].strip()
    return ("…" if start > 0 else "") + snippet + ("…" if end < len(body) else "")


def build_evidence_by_key(graph: dict, chunks: list, max_per_entity: int, max_quote_chars: int) -> dict:
    chunk_by_id = {c["chunk_id"]: c for c in chunks}
    out: dict = {}
    for e in graph.get("entities", []):
        recs = []
        seen = set()
        for evidence_id in e.get("evidence", []):
            if evidence_id in seen:
                continue
            seen.add(evidence_id)
            if evidence_id.startswith("doc:"):
                continue  # document-level facts have no specific quoted passage
            chunk = chunk_by_id.get(evidence_id)
            if chunk is None:
                continue
            text = truncate_around_mention(chunk.get("body", ""), e["name"], max_quote_chars)
            recs.append({"doc": chunk.get("doc_title", ""), "text": text})
            if len(recs) >= max_per_entity:
                break
        if recs:
            out[e["key"]] = recs
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph", required=True, type=Path)
    ap.add_argument("--ontology", required=True, type=Path)
    ap.add_argument("--chunks", required=True, type=Path)
    ap.add_argument("--title", required=True)
    ap.add_argument("--arm-label", default=None)
    ap.add_argument("--arm-key", default="HE")
    ap.add_argument("--max-quotes-per-entity", type=int, default=3,
                     help="cap real quotes shown per entity -- some entities (e.g. גדה המערבית, "
                          "support 639) have far more evidence than is useful or size-sane to bake in")
    ap.add_argument("--max-quote-chars", type=int, default=280,
                     help="cap each quote's length, trimmed (never reworded) around the entity's "
                          "own name where findable -- full chunk bodies average ~1,660 chars, too "
                          "large to bake in per entity per evidence reference at this corpus's scale")
    ap.add_argument("--chat", action="store_true")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    chunks = json.loads(args.chunks.read_text(encoding="utf-8"))

    data = ba.build_data(graph, ontology, args.arm_key, args.title, args.arm_label)
    evidence = build_evidence_by_key(graph, chunks, args.max_quotes_per_entity, args.max_quote_chars)

    entities, relations = data[args.arm_key]["entities"], data[args.arm_key]["relations"]
    classes, properties = data[args.arm_key]["classes"], data[args.arm_key]["properties"]
    print(f"DATA: {len(entities)} entities, {len(relations)} relations, {len(classes)} classes, "
          f"{len(properties)} properties, real chunk-quoted evidence for {len(evidence)} entities")

    html = ba.TEMPLATE_PATH.read_text(encoding="utf-8")
    if not args.chat:
        html = ba.strip_chat(html)
    html = html.replace(ba.DEFAULT_TITLE_LITERAL, args.title)
    html = html.replace("__KG_DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    html = html.replace("__KG_EVIDENCE__", json.dumps(evidence, ensure_ascii=False, separators=(",", ":")))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"Wrote {args.out} ({size_mb:.2f} MB)")
    if size_mb > 15:
        print("WARNING: over ~15MB -- close to the Artifact tool's 16MB limit; lower "
              "--max-quotes-per-entity")
    print("BUILD OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

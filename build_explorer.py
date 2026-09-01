#!/usr/bin/env python3
"""Splice this repo's graph/ontology data into nanonto's self-contained KG
explorer template, producing a single static HTML file for GitHub Pages.

The template (kg_explorer_template.html, from the nanonto engine repo) is
generic and arm-based; this script adapts it to this repo's single Hebrew
dataset and disables the template's built-in "chat" panel, which calls
api.anthropic.com directly with no key and is not part of this repo's
BYOK/MCP design -- the page here is meant to be graphics-only.

Usage:
    python3 build_explorer.py --template path/to/kg_explorer_template.html \
        --graph heb-graph/graph.json --ontology heb-graph/ontology.json \
        --chunks heb-graph/chunks.json --label "Hebrew corpus (KeremNavotHeb)" \
        --out _site/index.html
"""
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path
from typing import Any, Dict, List


def doc_id_of(evidence_id: str) -> str:
    if evidence_id.startswith("doc:"):
        return evidence_id[len("doc:"):]
    return evidence_id.split("#", 1)[0]


def build_dataset(graph: Dict[str, Any], ontology: Dict[str, Any], chunks: List[Dict[str, Any]],
                   label: str) -> Dict[str, Any]:
    doc_title_by_id = {}
    for c in chunks:
        doc_title_by_id.setdefault(c["doc_id"], c.get("doc_title", c["doc_id"]))

    doc_ids = sorted(doc_title_by_id)
    doc_index = {doc_id: i for i, doc_id in enumerate(doc_ids)}
    docs_list = [doc_title_by_id[d] for d in doc_ids]

    entity_keys = {e["key"] for e in graph["entities"]}

    entities = []
    for e in graph["entities"]:
        doc_counts: collections.Counter = collections.Counter(
            doc_id_of(ev) for ev in e.get("evidence", []) if doc_id_of(ev) in doc_index
        )
        primary_doc = doc_index[doc_counts.most_common(1)[0][0]] if doc_counts else None
        entities.append({
            "k": e["key"],
            "n": e["name"],
            "t": e["type"],
            "s": e.get("support", len(e.get("evidence", []))),
            "a": e.get("aliases", []),
            "y": False,
            "d": primary_doc,
        })

    relations = []
    for r in graph["relationships"]:
        relations.append({
            "s": r["source"],
            "t": r["target"],
            "p": r["type"],
            "w": r.get("support", len(r.get("evidence", []))),
        })

    classes = []
    for c in ontology.get("classes", []):
        instances = [k for k in c.get("instances", []) if k in entity_keys]
        classes.append({"n": c["name"], "i": instances})

    return {
        "entities": entities,
        "relations": relations,
        "classes": classes,
        "docs": docs_list,
        "label": f"{label} — {len(entities)} entities, {len(relations)} relations, "
                 f"{len(docs_list)} documents, {len(classes)} ontology classes",
    }


def splice(template_html: str, dataset: Dict[str, Any], arm_key: str, arm_title: str) -> str:
    data_json = json.dumps({arm_key: dataset}, ensure_ascii=False)
    html = template_html.replace("__KG_DATA__", data_json)

    html = re.sub(
        r'const ARM_ORDER = \[.*?\];',
        f'const ARM_ORDER = ["{arm_key}"];',
        html, count=1,
    )
    html = re.sub(
        r'const ARM_TITLES = \{.*?\};',
        f'const ARM_TITLES = {{ "{arm_key}": {json.dumps(arm_title, ensure_ascii=False)} }};',
        html, count=1,
    )

    # The template's bundled "chat" panel calls api.anthropic.com directly with
    # no key -- not this repo's design (BYOK/MCP happen elsewhere). Hide it
    # rather than delete it: other code still references #chatToggleBtn by id.
    html = html.replace(
        "</style>",
        "#chatToggleBtn{display:none !important}\n</style>",
        1,
    )
    return html


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--template", required=True, type=Path)
    ap.add_argument("--graph", required=True, type=Path)
    ap.add_argument("--ontology", required=True, type=Path)
    ap.add_argument("--chunks", required=True, type=Path)
    ap.add_argument("--label", default="Hebrew corpus (KeremNavotHeb)")
    ap.add_argument("--arm-key", default="HE")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    chunks = json.loads(args.chunks.read_text(encoding="utf-8"))
    template_html = args.template.read_text(encoding="utf-8")

    dataset = build_dataset(graph, ontology, chunks, args.label)
    html = splice(template_html, dataset, args.arm_key, args.label)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html):,} chars) -- {dataset['label']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

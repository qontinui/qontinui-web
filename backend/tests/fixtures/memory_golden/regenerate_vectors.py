#!/usr/bin/env python3
"""Regenerate the golden set's committed vectors from the deployed model.

Run this OUT OF BAND — never from the test suite. The backend embeds nothing
by design (``app/services/memory_vectors.py``; ``tests/test_no_fastembed_import.py``
enforces it), so the vectors are data produced here and committed, which is
also what keeps the harness deterministic across machines.

The source of truth is the runner's local embedding service — the same one
that embedded the CORPUS via ``memory_synthesis.rs``'s ``JobKind::Embedding``
path, so query and corpus land in the same space by construction. Using any
other embedder would silently produce cross-space cosines that still report
``vector_arm: "hybrid"``.

Usage (with the runner's embedding service up):

    python regenerate_vectors.py                    # writes in place
    python regenerate_vectors.py --check            # verify only, exit 1 on drift
    python regenerate_vectors.py --url http://...   # non-default endpoint

Then flip ``manifest.json``'s ``embedding_source`` to the model tag and
re-record the baseline in the plan's §3 Phase 2.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Matches qontinui-runner `embedding_client.rs` DEFAULT_EMBEDDING_URL. The
# request body shape (`text` + `model`) mirrors `compute_text_embedding`, so
# this script and the runner ask the service the same question.
DEFAULT_URL = "http://127.0.0.1:8001/api/embeddings/compute-text"
REQUEST_MODEL = "minilm"

# The tag the vectors are STAMPED with — app/services/memory_vectors.py's
# EMBEDDING_MODEL_TAG and the runner's constant of the same name. The service
# above is what actually produces the space; this names it.
MODEL_TAG = "minilm-l6-v2-256@sentence-transformers"
EXPECTED_DIM = 384


def embed(text: str, url: str) -> list[float]:
    """One 384-dim unit vector, or raise with a legible reason."""
    body = json.dumps({"text": text, "model": REQUEST_MODEL}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.load(resp)
    except urllib.error.URLError as exc:  # pragma: no cover — operational
        raise SystemExit(
            f"embedding service unreachable at {url}: {exc}\n"
            "Start the runner's embedding service (dev-start.ps1 -Embedding) "
            "and re-run."
        ) from exc

    if not payload.get("success"):
        raise SystemExit(f"embedding service returned an error: {payload.get('error')}")
    vec = payload["embedding"]
    if len(vec) != EXPECTED_DIM:
        raise SystemExit(f"expected {EXPECTED_DIM} dims, got {len(vec)}")
    norm = math.sqrt(sum(x * x for x in vec))
    # The retrieval arm is cosine; a non-unit vector would still "work" but
    # would mean the service changed its normalisation, which is a space
    # change worth failing on rather than absorbing.
    if abs(norm - 1.0) > 1e-3:
        raise SystemExit(f"expected an L2-normalised vector, got norm {norm:.6f}")
    return vec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify committed vectors still reproduce; do not write",
    )
    args = ap.parse_args()

    records = json.loads((HERE / "records.json").read_text(encoding="utf-8"))
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))

    drift: list[str] = []

    for rec in records:
        fresh = embed(rec["content"], args.url)
        if args.check:
            if rec.get("embedding") != fresh:
                drift.append(f"record {rec['key']}")
        else:
            rec["embedding"] = fresh

    for case in cases:
        fresh = embed(case["query_text"], args.url)
        if args.check:
            if case.get("query_embedding") != fresh:
                drift.append(f"case {case['case_id']}")
        else:
            case["query_embedding"] = fresh

    if args.check:
        if drift:
            print(
                f"DRIFT — {len(drift)} item(s) no longer reproduce; the service's "
                f"space changed. First: {drift[0]}",
                file=sys.stderr,
            )
            return 1
        print(f"OK — all {len(records)} records and {len(cases)} cases reproduce.")
        return 0

    # Two-space indent matches the committed formatting so the diff stays
    # reviewable as data rather than as a reformat.
    (HERE / "records.json").write_text(
        json.dumps(records, indent=2) + "\n", encoding="utf-8"
    )
    (HERE / "cases.json").write_text(
        json.dumps(cases, indent=2) + "\n", encoding="utf-8"
    )
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    manifest["embedding_source"] = MODEL_TAG
    (HERE / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {len(records)} record vectors + {len(cases)} query vectors; "
        f"embedding_source -> {MODEL_TAG}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

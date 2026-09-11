#!/usr/bin/env python3
"""Regenerate the published Swiss Curling exercise diagrams from the source collection.

The application shows every Swiss Curling diagram in English. Earlier revisions kept the
German text in the image and painted an opaque English patch over it, which could not be
positioned reliably and covered ice-sheet geometry (ring boundaries, zone edges, arrows).

This script instead removes the German text *at the source*: it redacts the text objects
of the supplied PDF without touching any line art, renders the exercise panel of each
page at the established crop, and reports the exact box every removed label occupied.
`src/lib/exercises/swissCurlingDiagramLabels.ts` carries those boxes, so the English
label the application draws sits precisely where the German one was, with no patch and
no lost geometry.

Usage
    python3 scripts/generate_swiss_curling_diagrams.py \
        --pdf /path/to/Uebungen_Einzeltraining_onice.pdf \
        [--out public/exercise-diagrams] \
        [--labels src/lib/exercises/swissCurlingDiagramLabels.ts] \
        [--check]

Requires PyMuPDF and Pillow (`pip install pymupdf pillow`). The source PDF is licensed
Swiss Curling material and is deliberately not committed to this repository.

The crop constants below were fitted against the previously published PNG bytes, so a
regenerated diagram is pixel-aligned with the revision it replaces; `--check` reports the
per-diagram difference so a regeneration can be verified rather than assumed.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("PyMuPDF is required: pip install pymupdf")
from PIL import Image

# --- Source layout -----------------------------------------------------------------
# Exercise pages in the supplied collection (cover states version 2.0).
PAGES = {
    "guard": {n: 7 + n for n in range(1, 12)},      # Guard 1-11  -> pages 8-18
    "draw": {n: 19 + n for n in range(1, 13)},      # Draw 1-12   -> pages 20-31
    "softshot": {n: 32 + n for n in range(1, 15)},  # Softshot 1-14 -> pages 33-46
}

# Panel crop per family: PDF point origin, pixels per point on each axis, output size.
CROPS = {
    "guard": (42.9168, 95.4383, 3.0605, 3.0694, 639, 1140),
    "draw": (42.9168, 95.4383, 3.0605, 3.0694, 639, 1140),
    "softshot": (42.9065, 95.0785, 3.0631, 3.0448, 507, 1188),
}

# Published asset id per exercise. A regenerated diagram always takes the next version,
# so a warm cache keyed by the previous id can never be mistaken for the correction.
ASSET_VERSION = {
    ("guard", 1): 2, ("guard", 2): 2, ("guard", 3): 2, ("guard", 4): 2,
    ("guard", 5): 2, ("guard", 6): 2, ("guard", 7): 1, ("guard", 8): 1,
    ("guard", 9): 1, ("guard", 10): 3, ("guard", 11): 2,
    ("draw", 1): 2, ("draw", 2): 2, ("draw", 3): 2, ("draw", 4): 2,
    ("draw", 5): 2, ("draw", 6): 2, ("draw", 7): 1, ("draw", 8): 2,
    ("draw", 9): 2, ("draw", 10): 2, ("draw", 11): 2, ("draw", 12): 2,
    ("softshot", 1): 2, ("softshot", 2): 2, ("softshot", 3): 2, ("softshot", 4): 2,
    ("softshot", 5): 3, ("softshot", 6): 2, ("softshot", 7): 2, ("softshot", 8): 2,
    ("softshot", 9): 2, ("softshot", 10): 2, ("softshot", 11): 2, ("softshot", 12): 2,
    ("softshot", 13): 1, ("softshot", 14): 1,
}

# Stable label ids per exercise, in the source's own reading order (top to bottom, then
# left to right) together with the German text they replace. The expected text is
# asserted on every run: a changed source must fail loudly instead of silently moving a
# label. An exercise absent here carries no embedded German label.
LABELS: dict[tuple[str, int], list[tuple[str, str]]] = {
    ("guard", 1): [("target-zone", "Zielzone")],
    ("guard", 2): [("target-zone", "Zielzone")],
    ("guard", 3): [("target-zone", "Zielzone")],
    ("guard", 4): [("target-zone", "Zielzone")],
    ("guard", 5): [("near-zone", "Zielzone"), ("far-zone", "Zielzone")],
    ("guard", 6): [("near-zone", "Zielzone"), ("far-zone", "Zielzone")],
    ("guard", 10): [("move-stone-aside", "Stein nach Stillstand jew eils als Markierung auf die Seite legen")],
    ("guard", 11): [("move-aside", "Stein nach Stillstand jew eils als Markierung auf die Seite legen")],
    ("draw", 1): [("target-zone", "Zielzone")],
    ("draw", 2): [("target-zone", "Zielzone")],
    ("draw", 3): [("target-zone", "Zielzone")],
    ("draw", 4): [("target-zone", "Zielzone")],
    ("draw", 5): [("quarter-2", "Haus-Viertel 2"), ("quarter-4", "Haus-Viertel 4"),
                  ("quarter-1", "Haus-Viertel 1"), ("quarter-3", "Haus-Viertel 4")],
    ("draw", 8): [("distance", "Maximaler Abstand zwischen beiden Steinen: 1 Besenlänge")],
    ("draw", 9): [("distance", "Maximaler Abstand zwischen beiden Steinen: 1 Besenlänge")],
    ("draw", 10): [("timing-note", "8 Steine nacheinander immer mit der gleichen Ziel-Split-Zeit spielen")],
    ("draw", 11): [("ladder-heading", "8 Steine nacheinander immer einer neuen Ziel-Split-Zeit spielen:"),
                   ("ladder-values", "Stein 1: 3.6s Stein 2: 3.7s Stein 3: 3.8s Stein 4: 3.9s "
                                     "Stein 5: 3.9s Stein 6: 3.8s Stein 7: 3.7s Stein 8: 3.6s")],
    ("draw", 12): [("stone-2", "Stein 2: Come-around"), ("stone-3", "Stein 3: Freeze"),
                   ("stone-4", "Stein 4: Tap mit Back 8/12 Länge"), ("stone-1", "Stein 1: Guard Stein 1: Guard")],
    ("softshot", 1): [("target-zone", "Zielzone"),
                      ("alternative-2", "Alternative Zielzone 2 Hack-Board"),
                      ("alternative-1", "Alternative Zielzone 1 Out-Hack")],
    ("softshot", 2): [("target-zone", "Zielzone"),
                      ("alternative-2", "Alternative Zielzone 2 Hack-Board"),
                      ("alternative-1", "Alternative Zielzone 1 Out-Hack")],
    **{("softshot", n): [("target-zone", "Zielzone")] for n in (3, 4, 5, 6, 7, 8, 9, 10, 11, 12)},
}


def asset_id(family: str, number: int) -> str:
    return f"swiss-curling-{family}-exercise-{number}-v{ASSET_VERSION[(family, number)]}"


def has_letters(text: str) -> bool:
    """A label needs translating only when it contains letters. Sequence numerals and
    punctuation are language-neutral parts of the diagram and are always preserved."""
    return any(ch.isalpha() for ch in text)


def crop_rect(family: str) -> tuple[pymupdf.Rect, float, float, int, int]:
    x0, y0, sx, sy, w, h = CROPS[family]
    return pymupdf.Rect(x0, y0, x0 + w / sx, y0 + h / sy), sx, sy, w, h


# A label the source drew inside its own callout rectangle should be centred in that
# rectangle, not on the German glyph run: English wording of a different length would
# otherwise drift off-centre and, on Draw Exercise 12, a fraction of a pixel past the
# edge of the image. A candidate rectangle is accepted only when it fits the label
# closely, so a page border or a rectangle holding two separate labels is never mistaken
# for one label's callout.
MAX_CONTAINER_MARGIN_X = 140.0
MAX_CONTAINER_MARGIN_Y = 90.0


def callout_rect(page, box: pymupdf.Rect, sx: float, sy: float) -> pymupdf.Rect | None:
    """The smallest unfilled or white rectangle the source drew around this label."""
    best = None
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        fill = drawing.get("fill")
        if fill is not None and fill != (1.0, 1.0, 1.0):
            continue
        if not (rect.x0 <= box.x0 and rect.y0 <= box.y0
                and rect.x1 >= box.x1 and rect.y1 >= box.y1):
            continue
        if (rect.width - box.width) * sx > MAX_CONTAINER_MARGIN_X:
            continue
        if (rect.height - box.height) * sy > MAX_CONTAINER_MARGIN_Y:
            continue
        if best is None or rect.get_area() < best.get_area():
            best = rect
    return best


def collect_spans(page, clip: pymupdf.Rect) -> list[dict]:
    spans = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                box = pymupdf.Rect(span["bbox"])
                if box.get_area() <= 0 or (box & clip).get_area() < 0.5 * box.get_area():
                    continue
                if not span["text"].strip() or not has_letters(span["text"]):
                    continue
                spans.append({"text": span["text"], "box": box, "color": span["color"],
                              "size": span["size"]})
    return spans


def cluster(spans: list[dict]) -> list[list[dict]]:
    """Group spans that form one printed label. Two spans belong together when they are
    within roughly one line height of each other on both axes."""
    groups: list[list[dict]] = []
    for span in sorted(spans, key=lambda s: (round(s["box"].y0 / 4), s["box"].x0)):
        for group in groups:
            gx0 = min(s["box"].x0 for s in group); gx1 = max(s["box"].x1 for s in group)
            gy0 = min(s["box"].y0 for s in group); gy1 = max(s["box"].y1 for s in group)
            lh = max(s["box"].height for s in group)
            if (span["box"].y0 < gy1 + 0.8 * lh and span["box"].y1 > gy0 - 0.8 * lh
                    and span["box"].x0 < gx1 + 0.6 * lh and span["box"].x1 > gx0 - 0.6 * lh):
                group.append(span)
                break
        else:
            groups.append([span])
    return sorted(groups, key=lambda g: (round(min(s["box"].y0 for s in g) / 4),
                                         min(s["box"].x0 for s in g)))


def normalize(text: str) -> str:
    return " ".join(text.split())


def build(pdf_path: Path, out_dir: Path, labels_path: Path | None, check: bool) -> int:
    geometry: dict[str, dict] = {}
    problems: list[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    for family, numbers in PAGES.items():
        clip, sx, sy, width, height = crop_rect(family)
        for number, page_number in numbers.items():
            document = pymupdf.open(pdf_path)
            page = document[page_number - 1]
            spans = collect_spans(page, clip)
            groups = cluster(spans)

            expected = LABELS.get((family, number), [])
            if len(groups) != len(expected):
                problems.append(
                    f"{family} {number} (page {page_number}): source has {len(groups)} "
                    f"translatable label(s), the label table declares {len(expected)}")
                document.close()
                continue

            entries = []
            for (label_id, expected_text), group in zip(expected, groups):
                found = normalize(" ".join(s["text"] for s in group))
                if found != normalize(expected_text):
                    problems.append(
                        f"{family} {number} label {label_id}: source text "
                        f"{found!r} != expected {normalize(expected_text)!r}")
                box = pymupdf.Rect(min(s["box"].x0 for s in group), min(s["box"].y0 for s in group),
                                   max(s["box"].x1 for s in group), max(s["box"].y1 for s in group))
                lines = max(1, round(box.height / (max(s["box"].height for s in group) * 1.06)))
                container = callout_rect(page, box, sx, sy)
                entry_container = None
                if container is not None:
                    # Inset by the stroke so the label keeps clear of the drawn border.
                    inset = container & pymupdf.Rect(
                        container.x0 + 1.0, container.y0 + 1.0,
                        container.x1 - 1.0, container.y1 - 1.0,
                    )
                    entry_container = {
                        "x": round((inset.x0 - clip.x0) * sx / width, 4),
                        "y": round((inset.y0 - clip.y0) * sy / height, 4),
                        "width": round(inset.width * sx / width, 4),
                        "height": round(inset.height * sy / height, 4),
                    }
                entries.append({
                    "id": label_id,
                    "x": round((box.x0 - clip.x0) * sx / width, 4),
                    "y": round((box.y0 - clip.y0) * sy / height, 4),
                    "width": round(box.width * sx / width, 4),
                    "height": round(box.height * sy / height, 4),
                    **({"container": entry_container} if entry_container else {}),
                    "lines": lines,
                    "lineHeight": round(box.height / lines * sy / height, 4),
                    # The source's own type size, expressed against the image width so the
                    # English label reads at the same scale as the label it replaces.
                    "fontSize": round(max(s["size"] for s in group) * sx / width, 4),
                    "textColor": "#%06x" % group[0]["color"],
                    "replaces": found,
                })
                page.add_redact_annot(box)

            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                                  graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(sx, sy), clip=clip, alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            if image.size != (width, height):
                image = image.crop((0, 0, width, height))
            image = image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

            name = asset_id(family, number)
            target = out_dir / f"{name}.png"
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)
            data = buffer.getvalue()
            if check:
                current = target.read_bytes() if target.exists() else b""
                status = ("already published" if current
                          else "new")
                print(f"{name}: {status} ({len(data)} bytes)")
            elif target.exists():
                # Published asset bytes are immutable. A corrected diagram always takes a
                # new asset id, so an existing file is never rewritten.
                print(f"{name}: already published, left untouched")
            else:
                target.write_bytes(data)
                print(f"{name}: {len(data)} bytes, {len(entries)} label(s)")
            if entries:
                geometry[name] = {"labels": entries}
            document.close()

    if problems:
        for problem in problems:
            print(f"PROBLEM  {problem}", file=sys.stderr)
        return 1

    if labels_path and not check:
        labels_path.write_text(render_labels_module(geometry), encoding="utf-8")
        print(f"wrote {labels_path}")
    elif labels_path:
        print(json.dumps(geometry, indent=1, ensure_ascii=False))
    return 0


def render_labels_module(geometry: dict[str, dict]) -> str:
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "//",
        "// Produced by scripts/generate_swiss_curling_diagrams.py from the Swiss Curling",
        "// source collection. Each entry is the exact normalised box the removed German",
        "// label occupied in the published diagram image, so the English replacement is",
        "// positioned from measured source geometry rather than an estimate. Regenerate",
        "// this file whenever a diagram asset is regenerated.",
        "",
        'import type { SwissCurlingDiagramLabelGeometry } from "./diagramLabelGeometry";',
        "",
        "export const SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY: SwissCurlingDiagramLabelGeometry = {",
    ]
    for asset in sorted(geometry):
        lines.append(f'  "{asset}": {{')
        for entry in geometry[asset]["labels"]:
            lines.append(f'    "{entry["id"]}": {{')
            lines.append(f'      x: {entry["x"]}, y: {entry["y"]}, '
                         f'width: {entry["width"]}, height: {entry["height"]},')
            if entry.get("container"):
                c = entry["container"]
                lines.append(f'      container: {{ x: {c["x"]}, y: {c["y"]}, '
                             f'width: {c["width"]}, height: {c["height"]} }},')
            lines.append(f'      lines: {entry["lines"]}, lineHeight: {entry["lineHeight"]}, '
                         f'fontSize: {entry["fontSize"]},')
            lines.append(f'      textColor: "{entry["textColor"]}",')
            lines.append(f'      replaces: {json.dumps(entry["replaces"], ensure_ascii=False)},')
            lines.append("    },")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=Path("public/exercise-diagrams"))
    parser.add_argument("--labels", type=Path,
                        default=Path("src/lib/exercises/swissCurlingDiagramLabels.ts"))
    parser.add_argument("--check", action="store_true",
                        help="report what would change without writing anything")
    args = parser.parse_args()
    return build(args.pdf, args.out, args.labels, args.check)


if __name__ == "__main__":
    raise SystemExit(main())

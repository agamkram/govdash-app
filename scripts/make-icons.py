#!/usr/bin/env python3
"""GovDash PWA icons — nested hierarchy cascade (not a map pin).

Usage: python3 scripts/make-icons.py
Writes icon-192/512, icon-maskable-512, apple-touch-icon into repo root.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

BG = (18, 21, 24, 255)  # --bg
PANEL = (26, 29, 33, 255)  # --panel
ACCENT = (90, 142, 176, 255)  # --accent


def draw_cascade(size: int, *, maskable: bool = False) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size - 1, size - 1], fill=BG)
    m = int(size * (0.10 if maskable else 0.05))
    r_plate = int(size * (0.16 if maskable else 0.20))
    d.rounded_rectangle(
        [m, m, size - 1 - m, size - 1 - m], radius=r_plate, fill=PANEL
    )

    pad = int(size * (0.20 if maskable else 0.18))
    x0, y0 = pad, pad
    x1, y1 = size - 1 - pad, size - 1 - pad
    aw, ah = x1 - x0, y1 - y0

    gap = max(2, int(ah * 0.08))
    h = (ah - 2 * gap) / 3.15
    r = max(4, int(size * 0.055))

    fills = [
        ACCENT,
        (72, 118, 152, 255),
        (155, 178, 198, 255),
    ]
    insets = [0.00, 0.16, 0.32]
    rights = [0.00, 0.06, 0.12]

    for i, (fill, ins, rt) in enumerate(zip(fills, insets, rights)):
        top = y0 + i * (h + gap)
        bottom = top + h
        left = x0 + aw * ins
        right = x1 - aw * rt
        d.rounded_rectangle([left, top, right, bottom], radius=r, fill=fill)

    return im


def main() -> None:
    # New filenames so Safari drops the old map-pin tab favicon cache.
    draw_cascade(512).save(ROOT / "icon-cascade-512.png", optimize=True)
    draw_cascade(192).save(ROOT / "icon-cascade-192.png", optimize=True)
    draw_cascade(512, maskable=True).save(
        ROOT / "icon-cascade-maskable-512.png", optimize=True
    )
    draw_cascade(180).save(ROOT / "apple-touch-icon-cascade.png", optimize=True)
    # Keep legacy paths in sync for any bookmarked / cached deep links.
    draw_cascade(512).save(ROOT / "icon-512.png", optimize=True)
    draw_cascade(192).save(ROOT / "icon-192.png", optimize=True)
    draw_cascade(512, maskable=True).save(ROOT / "icon-maskable-512.png", optimize=True)
    draw_cascade(180).save(ROOT / "apple-touch-icon.png", optimize=True)
    print(
        "Wrote icon-cascade-192/512, apple-touch-icon-cascade (+ legacy names)"
    )


if __name__ == "__main__":
    main()

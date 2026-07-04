"""Generates desktop/icon.ico (the launcher exe's icon) from scratch with Pillow - no external
asset/rasterizer needed. Matches the app's own dark-navy/cyan palette (css/app.css --ink/--sig)
and its hand-drawn aircraft glyphs (js/15-map-render.js): a radar sweep with a top-view aircraft
silhouette at the center. Run once (or whenever the design changes):  python desktop/build_icon.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

INK = (11, 14, 19, 255)      # --ink
PANEL = (18, 23, 31, 255)    # --panel
SIG = (56, 189, 248, 255)    # --sig (cyan accent)
WHITE = (240, 248, 255, 255)

OUT = Path(__file__).resolve().parent / "icon.ico"


def draw_aircraft(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float, color):
    """Simple top-view aircraft dart (fuselage + swept wings + tailplane), nose pointing up -
    same silhouette language as drawP3Orion/drawGulfstreamIV in js/15-map-render.js, simplified
    for legibility at icon sizes."""
    s = scale
    fuselage = [
        (cx, cy - 1.00 * s), (cx + 0.07 * s, cy - 0.78 * s), (cx + 0.07 * s, cy + 0.55 * s),
        (cx, cy + 0.85 * s), (cx - 0.07 * s, cy + 0.55 * s), (cx - 0.07 * s, cy - 0.78 * s),
    ]
    wings = [
        (cx, cy - 0.05 * s), (cx + 0.95 * s, cy + 0.42 * s), (cx + 0.95 * s, cy + 0.58 * s),
        (cx, cy + 0.30 * s),
        (cx - 0.95 * s, cy + 0.58 * s), (cx - 0.95 * s, cy + 0.42 * s),
    ]
    tail = [
        (cx, cy + 0.55 * s), (cx + 0.4 * s, cy + 0.82 * s), (cx + 0.4 * s, cy + 0.90 * s),
        (cx, cy + 0.72 * s),
        (cx - 0.4 * s, cy + 0.90 * s), (cx - 0.4 * s, cy + 0.82 * s),
    ]
    draw.polygon(wings, fill=color)
    draw.polygon(tail, fill=color)
    draw.polygon(fuselage, fill=color)


def make_base(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = size / 2
    r_outer = size * 0.47

    # Rounded-square dark navy background (matches the app's card surfaces).
    radius = size * 0.22
    draw.rounded_rectangle([1, 1, size - 2, size - 2], radius=radius, fill=INK, outline=PANEL, width=max(1, size // 64))

    # Below ~24px, rings/crosshair/sweep just muddy into noise - simplify to one ring and a
    # bigger, bolder aircraft so the icon still reads at taskbar/title-bar scale.
    tiny = size <= 24

    # Radar rings, cyan, thinning with distance - evokes the app's map/tracker aesthetic.
    ring_fracs = (1.0,) if tiny else (1.0, 0.68, 0.36)
    for i, frac in enumerate(ring_fracs):
        alpha = int(110 - i * 20) if tiny else int(90 - i * 20)
        ring_color = SIG[:3] + (max(alpha, 40),)
        w = max(1, round(size * (0.02 if tiny else 0.012)))
        rr = r_outer * frac
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=ring_color, width=w)

    if not tiny:
        # Radar sweep wedge (a soft cyan pie slice), rotated to upper-right like a live scan.
        sweep_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sweep_draw = ImageDraw.Draw(sweep_img)
        sweep_draw.pieslice([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], -95, -35, fill=SIG[:3] + (70,))
        img = Image.alpha_composite(img, sweep_img)
        draw = ImageDraw.Draw(img)

        # Crosshair through the center, faint.
        hair = SIG[:3] + (55,)
        hw = max(1, round(size * 0.008))
        draw.line([cx - r_outer * 0.92, cy, cx + r_outer * 0.92, cy], fill=hair, width=hw)
        draw.line([cx, cy - r_outer * 0.92, cx, cy + r_outer * 0.92], fill=hair, width=hw)

    # Aircraft glyph at the center, white with a subtle cyan halo for contrast on dark navy.
    draw_aircraft(draw, cx, cy, r_outer * (0.8 if tiny else 0.62), WHITE)

    return img


def main():
    sizes = [16, 24, 32, 48, 64, 128, 256]
    base = make_base(256)
    images = [base] + [base.resize((s, s), Image.LANCZOS) for s in sizes if s != 256]
    base.save(OUT, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()

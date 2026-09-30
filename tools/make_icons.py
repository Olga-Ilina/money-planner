#!/usr/bin/env python3
"""Draw the app icons into public/icons/.

Rounded square in #4F46E5 with a white euro sign. The euro sign is drawn from
geometric shapes (arc + two bars), so the output does not depend on the fonts
installed on the machine.

Outputs:
  icon-180.png           apple-touch-icon; full-bleed square (iOS rounds the
                         corners itself and shows transparent pixels as black)
  icon-192.png           rounded square, transparent corners
  icon-512.png           rounded square, transparent corners
  icon-512-maskable.png  full-bleed background, glyph inside the 80% safe zone

Usage: tools/.venv/bin/python tools/make_icons.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

BG = (0x4F, 0x46, 0xE5, 255)
FG = (255, 255, 255, 255)
SUPERSAMPLE = 4
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"


def draw_euro(draw: ImageDraw.ImageDraw, size: int, scale: float) -> None:
    """Draw a euro sign centred on the canvas; scale 1.0 spans about 58% of its width."""
    s = size * scale
    stroke = round(0.075 * s)
    radius = 0.27 * s
    # The bars stick out to the left, so shift the arc right to keep the glyph centred.
    ax = size / 2 + 0.09 * s
    ay = size / 2
    draw.arc(
        [ax - radius, ay - radius, ax + radius, ay + radius],
        start=42,
        end=318,
        fill=FG,
        width=stroke,
    )
    bar_h = 0.06 * s
    bar_gap = 0.075 * s
    left = ax - radius - 0.11 * s
    right = ax + 0.07 * s
    for cy in (ay - bar_gap, ay + bar_gap):
        draw.rectangle([left, cy - bar_h / 2, right, cy + bar_h / 2], fill=FG)


def render(size: int, rounded: bool, glyph_scale: float) -> Image.Image:
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if rounded:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=round(0.225 * big), fill=BG)
    else:
        draw.rectangle([0, 0, big - 1, big - 1], fill=BG)
    draw_euro(draw, big, glyph_scale)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-180.png", 180, False, 1.0),
        ("icon-192.png", 192, True, 1.0),
        ("icon-512.png", 512, True, 1.0),
        # Safe zone = circle of radius 40% of the size; the glyph stays well inside it.
        ("icon-512-maskable.png", 512, False, 0.8),
    ]
    for name, size, rounded, scale in targets:
        path = OUT_DIR / name
        render(size, rounded, scale).save(path, optimize=True)
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent)}")


if __name__ == "__main__":
    main()

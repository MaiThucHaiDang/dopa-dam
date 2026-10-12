"""Draws the DopaDam icon (a small dam holding back water) and exports PNG sizes.

Usage: python shared/brand/make_icons.py
Needs Pillow. Colors come from shared/design-tokens/tokens.json.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
TOKENS = json.loads((ROOT / "shared/design-tokens/tokens.json").read_text(encoding="utf-8"))["color"]
S = 4096  # draw large, then downsample for anti-aliasing


def hex_rgb(value):
    return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5))


def p(x, y):
    return (round(x * S), round(y * S))


def draw_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg, water, wall, ground = (hex_rgb(TOKENS[k]) for k in ("bg", "accent", "text", "border"))

    d.rounded_rectangle([p(0.04, 0.04), p(0.96, 0.96)], radius=round(0.22 * S), fill=bg)
    # Reservoir held back by the dam, with a soft wave on top.
    d.rectangle([p(0.17, 0.44), p(0.55, 0.76)], fill=water)
    for cx in (0.2325, 0.3575, 0.4825):
        d.ellipse([p(cx - 0.0625, 0.40), p(cx + 0.0625, 0.48)], fill=water)
    # Dam wall: a trapezoid, narrow at the top.
    d.polygon([p(0.53, 0.28), p(0.62, 0.28), p(0.80, 0.76), p(0.53, 0.76)], fill=wall)
    # The controlled release downstream: a thin stream past the foot of the dam.
    d.rectangle([p(0.79, 0.725), p(0.88, 0.76)], fill=water)
    # Ground line.
    d.rounded_rectangle([p(0.14, 0.76), p(0.88, 0.81)], radius=round(0.02 * S), fill=ground)
    return img


def main():
    master = draw_master()
    outputs = {
        ROOT / "shared/brand/icon-1024.png": 1024,
        ROOT / "extension/icons/icon-16.png": 16,
        ROOT / "extension/icons/icon-32.png": 32,
        ROOT / "extension/icons/icon-48.png": 48,
        ROOT / "extension/icons/icon-128.png": 128,
    }
    for path, size in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()

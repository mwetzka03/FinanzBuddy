"""Generate FinanzBuddy app icon: coin with stylized F and currency hint, theme gradient, transparent."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app-icon.png"
PUBLIC_DIR = ROOT / "public"
ICONS_DIR = ROOT / "src-tauri" / "icons"
SIZE = 1024

GRADIENT_LEFT = (124, 58, 237)   # #7c3aed
GRADIENT_RIGHT = (30, 58, 138)   # #1e3a8a
GOLD_LIGHT = (252, 211, 77)
GOLD_MID = (245, 158, 11)
GOLD_DARK = (180, 120, 20)
F_WHITE = (255, 255, 255)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(lerp(c1[0], c2[0], t)),
        int(lerp(c1[1], c2[1], t)),
        int(lerp(c1[2], c2[2], t)),
    )


def gradient_at(x: float, x0: float, x1: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, (x - x0) / (x1 - x0) if x1 > x0 else 0.5))
    return lerp_color(GRADIENT_LEFT, GRADIENT_RIGHT, t)


def fill_polygon_gradient(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], x0: float, x1: float) -> None:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    mask = Image.new("L", (SIZE, SIZE), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(points, fill=255)
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = overlay.load()
    mask_px = mask.load()
    for y in range(max(0, int(min_y)), min(SIZE, int(max_y) + 1)):
        for x in range(max(0, int(min_x)), min(SIZE, int(max_x) + 1)):
            if mask_px[x, y] == 0:
                continue
            r, g, b = gradient_at(x, x0, x1)
            px[x, y] = (r, g, b, 255)
    draw._image.alpha_composite(overlay)


def fill_polygon_solid(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], color: tuple[int, int, int, int]) -> None:
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask_draw = ImageDraw.Draw(overlay)
    mask_draw.polygon(points, fill=color)
    draw._image.alpha_composite(overlay)


def draw_coin_rim(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float) -> None:
    """Gold coin ring with subtle bevel."""
    outer = [cx - radius, cy - radius, cx + radius, cy + radius]
    inner_r = radius * 0.84
    inner = [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r]

    rim = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rim_draw = ImageDraw.Draw(rim)
    rim_draw.ellipse(outer, fill=(*GOLD_MID, 255))
    rim_draw.ellipse(inner, fill=(0, 0, 0, 0))
    draw._image.alpha_composite(rim)

    highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    hi_draw = ImageDraw.Draw(highlight)
    hi_outer = [cx - radius * 0.98, cy - radius * 0.98, cx + radius * 0.98, cy + radius * 0.98]
    hi_inner = [cx - inner_r * 1.02, cy - inner_r * 1.02, cx + inner_r * 1.02, cy + inner_r * 1.02]
    hi_draw.ellipse(hi_outer, fill=(*GOLD_LIGHT, 120))
    hi_draw.ellipse(hi_inner, fill=(0, 0, 0, 0))
    draw._image.alpha_composite(highlight)


def draw_coin_face(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float) -> tuple[float, float, float, float]:
    """Purple gradient coin face; returns bbox for emblem placement."""
    face_r = radius * 0.82
    x0 = cx - face_r
    x1 = cx + face_r
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = overlay.load()
    for y in range(int(cy - face_r), int(cy + face_r) + 1):
        for x in range(int(cx - face_r), int(cx + face_r) + 1):
            dx = x - cx
            dy = y - cy
            if dx * dx + dy * dy > face_r * face_r:
                continue
            r, g, b = gradient_at(x, x0, x1)
            px[x, y] = (r, g, b, 255)
    draw._image.alpha_composite(overlay)
    return x0, cy - face_r * 0.55, x1, cy + face_r * 0.55


def f_letter_parts(cx: float, cy: float, scale: float) -> list[list[tuple[float, float]]]:
    """Block F for coin face."""
    s = scale
    left = cx - 0.26 * s
    right = cx + 0.2 * s
    top = cy - 0.3 * s
    bottom = cy + 0.3 * s
    stem_w = 0.17 * s
    bar_h = 0.11 * s
    mid_y = cy - 0.02 * s
    mid_right = cx + 0.08 * s

    stem = [(left, top), (left + stem_w, top), (left + stem_w, bottom), (left, bottom)]
    top_bar = [(left, top), (right, top), (right, top + bar_h), (left, top + bar_h)]
    mid_bar = [(left, mid_y), (mid_right, mid_y), (mid_right, mid_y + bar_h * 0.92), (left, mid_y + bar_h * 0.92)]
    return [stem, top_bar, mid_bar]


def draw_currency_marks(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float) -> None:
    """Tiny € and $ hints on the coin rim."""
    size = max(28, int(radius * 0.17))
    try:
        font = ImageFont.truetype("segoeui.ttf", size)
    except OSError:
        try:
            font = ImageFont.truetype("arial.ttf", size)
        except OSError:
            font = ImageFont.load_default()

    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(overlay)
    euro_pos = (cx - radius * 0.34, cy + radius * 0.18)
    dollar_pos = (cx + radius * 0.08, cy + radius * 0.18)
    text_draw.text(euro_pos, "€", fill=(*GOLD_LIGHT, 220), font=font)
    text_draw.text(dollar_pos, "$", fill=(*GOLD_LIGHT, 220), font=font)
    draw._image.alpha_composite(overlay)


def render_logo() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = cy = SIZE / 2
    coin_radius = SIZE * 0.42

    draw_coin_rim(draw, cx, cy, coin_radius)
    x0, _, x1, _ = draw_coin_face(draw, cx, cy, coin_radius)

    f_scale = coin_radius * 1.05
    for part in f_letter_parts(cx, cy - SIZE * 0.02, f_scale):
        fill_polygon_solid(draw, part, (*F_WHITE, 245))

    draw_currency_marks(draw, cx, cy, coin_radius)
    return img


def write_public_assets(img: Image.Image) -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("image-icon.png", "logo.png", "app-icon.png"):
        target = PUBLIC_DIR / name
        img.save(target, format="PNG", optimize=True)
        print(f"saved {target}")


def write_tauri_icons(img: Image.Image) -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    size_map = {
        32: "32x32.png",
        64: "64x64.png",
        128: "128x128.png",
        256: "128x128@2x.png",
    }
    for size, filename in size_map.items():
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        path = ICONS_DIR / filename
        resized.save(path, format="PNG", optimize=True)
        print(f"saved {path}")

    img.resize((256, 256), Image.Resampling.LANCZOS).save(ICONS_DIR / "icon.png", format="PNG", optimize=True)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_images = [img.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
    ico_path = ICONS_DIR / "icon.ico"
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[im.size for im in ico_images],
        append_images=ico_images[1:],
    )
    print(f"saved {ico_path} ({len(ico_images)} sizes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--windows-icons-only",
        action="store_true",
        help="Rewrite src-tauri/icons from existing app-icon.png (after tauri icon).",
    )
    args = parser.parse_args()

    if args.windows_icons_only:
        if not OUT.exists():
            raise SystemExit(f"Missing source icon: {OUT}")
        img = Image.open(OUT).convert("RGBA")
        write_tauri_icons(img)
        return

    img = render_logo()
    img.save(OUT, format="PNG", optimize=True)
    print(f"saved {OUT}")
    write_public_assets(img)
    write_tauri_icons(img)


if __name__ == "__main__":
    main()

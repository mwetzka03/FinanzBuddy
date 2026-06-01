"""Remove light background from AI-generated logo and export transparent app icons."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "finanzbuddy-logo-source.png"
SRC_LEGACY = ROOT / "assets" / "finanzhelfer-logo-source.png"
FALLBACK_SRC = ROOT / "app-icon.png"
OUT = ROOT / "app-icon.png"
PUBLIC = ROOT / "public"
ICONS = ROOT / "src-tauri" / "icons"
CANVAS = 1024


def is_background(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return True
    if r >= 228 and g >= 228 and b >= 228:
        return True
    if max(r, g, b) - min(r, g, b) < 18 and min(r, g, b) >= 210:
        return True
    return False


def flood_clear_background(img: Image.Image) -> Image.Image:
    px = img.load()
    w, h = img.size
    seen: set[tuple[int, int]] = set()
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if (x, y) in seen or x < 0 or x >= w or y < 0 or y >= h:
            continue
        seen.add((x, y))
        r, g, b, a = px[x, y]
        if is_background(r, g, b, a):
            px[x, y] = (0, 0, 0, 0)
            q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    return img


def square_canvas(img: Image.Image, size: int = CANVAS) -> Image.Image:
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    if side != size:
        canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return canvas


def write_ico_only(img: Image.Image) -> None:
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_images = [img.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
    ico_images[0].save(
        ICONS / "icon.ico",
        format="ICO",
        sizes=[im.size for im in ico_images],
        append_images=ico_images[1:],
    )


def write_outputs(img: Image.Image) -> None:
    img.save(OUT, format="PNG", optimize=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name in ("logo.png", "app-icon.png", "image-icon.png"):
        img.save(PUBLIC / name, format="PNG", optimize=True)

    ICONS.mkdir(parents=True, exist_ok=True)
    size_map = {32: "32x32.png", 64: "64x64.png", 128: "128x128.png", 256: "128x128@2x.png"}
    for size, filename in size_map.items():
        img.resize((size, size), Image.Resampling.LANCZOS).save(ICONS / filename, format="PNG", optimize=True)
    img.resize((256, 256), Image.Resampling.LANCZOS).save(ICONS / "icon.png", format="PNG", optimize=True)
    write_ico_only(img)


def main() -> None:
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--ico-only":
        img = Image.open(OUT).convert("RGBA")
        write_ico_only(img)
        print("ICO rewritten with alpha from app-icon.png")
        return

    src = next((p for p in (SRC, SRC_LEGACY, FALLBACK_SRC) if p.exists()), None)
    if src is None:
        raise SystemExit("Logo source not found")

    img = Image.open(src).convert("RGBA")
    img = flood_clear_background(img)
    img = square_canvas(img)
    write_outputs(img)
    print(f"Transparent icon written from {src}")


if __name__ == "__main__":
    main()

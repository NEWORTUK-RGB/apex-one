#!/usr/bin/env python3
"""Generate APEX ONE PWA icons (pure stdlib — no PIL)."""
import struct, zlib, math, os

def png(width, height, rgba_rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))

def lerp(a, b, t):
    return a + (b - a) * t

def dist_seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / L2)) if L2 else 0.0
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)

def make(size, path, maskable=False):
    # gradient navy -> cyan diagonal, rounded square (or full bleed for maskable)
    c1 = (3, 8, 24)        # deep navy
    c2 = (0, 105, 160)     # mid
    c3 = (0, 200, 255)     # cyan
    radius = 0 if maskable else size * 0.22
    # letter "A" geometry, scaled; maskable keeps glyph inside 80% safe zone
    s = size * (0.72 if maskable else 0.86)
    off = (size - s) / 2
    apex = (off + s * 0.5, off + s * 0.18)
    left = (off + s * 0.20, off + s * 0.82)
    right = (off + s * 0.80, off + s * 0.82)
    bar_a = (off + s * 0.345, off + s * 0.60)
    bar_b = (off + s * 0.655, off + s * 0.60)
    stroke = s * 0.085
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # rounded-rect alpha
            if radius:
                rx = min(x, size - 1 - x)
                ry = min(y, size - 1 - y)
                if rx < radius and ry < radius:
                    d = math.hypot(radius - rx, radius - ry)
                    a = 255 if d <= radius - 1 else (0 if d >= radius + 1 else int(255 * (radius + 1 - d) / 2))
                else:
                    a = 255
            else:
                a = 255
            t = (x + y) / (2 * size)
            if t < 0.55:
                tt = t / 0.55
                r, g, b = (int(lerp(c1[i], c2[i], tt)) for i in range(3))
            else:
                tt = (t - 0.55) / 0.45
                r, g, b = (int(lerp(c2[i], c3[i], tt)) for i in range(3))
            # glyph: white "A" with soft edge
            d = min(
                dist_seg(x, y, *apex, *left),
                dist_seg(x, y, *apex, *right),
                dist_seg(x, y, *bar_a, *bar_b),
            )
            if d < stroke + 1.5:
                g_a = 1.0 if d <= stroke - 1.5 else (stroke + 1.5 - d) / 3.0
                r = int(lerp(r, 240, g_a))
                g = int(lerp(g, 250, g_a))
                b = int(lerp(b, 255, g_a))
            row += bytes((r, g, b, a))
        rows.append(row)
    with open(path, "wb") as f:
        f.write(png(size, size, rows))
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")

base = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(base, exist_ok=True)
make(192, os.path.join(base, "icon-192.png"))
make(512, os.path.join(base, "icon-512.png"))
make(512, os.path.join(base, "maskable-512.png"), maskable=True)
make(180, os.path.join(base, "apple-touch-icon.png"), maskable=True)

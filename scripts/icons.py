"""Generate the three install icons from the local mark. Python standard library."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / "public"
PATHS = [
    [(32, 46), (32, 28)],
    [(32, 38), (27, 37), (23, 35), (20, 32), (18, 27), (23, 27), (28, 29), (31, 33), (32, 38)],
    [(32, 32), (33, 26), (36, 22), (40, 19), (46, 18), (44, 24), (41, 28), (37, 31), (32, 32)],
    [(25, 46), (39, 46)],
]


def near(x, y, start, end):
    ax, ay = start
    bx, by = end
    t = max(0, min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
                   ((bx - ax) ** 2 + (by - ay) ** 2)))
    return math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= 1.32


def chunk(kind, data):
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))


def icon(name, size, maskable=False):
    rows = bytearray()
    for iy in range(size):
        rows.append(0)
        for ix in range(size):
            x, y = (ix + .5) * 64 / size, (iy + .5) * 64 / size
            inside = math.hypot(max(0, abs(x - 32) - 16), max(0, abs(y - 32) - 16)) <= 16
            if not (maskable or inside):
                rows.extend((0, 0, 0, 0))
                continue
            mark = any(near(x, y, a, b) for path in PATHS for a, b in zip(path, path[1:]))
            rows.extend((255, 255, 255, 255) if mark else (80, 110, 91, 255))
    payload = chunk(b"IHDR", struct.pack("!2I5B", size, size, 8, 6, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    (ROOT / name).write_bytes(b"\x89PNG\r\n\x1a\n" + payload)


icon("icon-192.png", 192)
icon("icon-512.png", 512)
icon("icon-maskable.png", 512, True)

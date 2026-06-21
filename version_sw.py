#!/usr/bin/env python3
"""
Stamp the Service Worker cache version with a content hash of index.html.

Usage (run before every Netlify deploy, or in a build hook):
    python3 tools/version_sw.py

This replaces the hardcoded version string in sw.js with one derived from
the SHA-256 of index.html, ensuring the SW always invalidates its cache
when the app content changes — even if the developer forgets to bump the
version manually.

Example: 'apexone-v2.0.1' → 'apexone-a3f8c1d2-v2.0.1'
"""

import hashlib
import re
import sys


def hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def stamp_sw(sw_path: str, content_hash: str) -> None:
    with open(sw_path, "r", encoding="utf-8") as f:
        sw = f.read()

    # Match existing version strings like 'apexone-v2.0.1' or 'apexone-abc12345-v2.0.1'
    pattern = re.compile(r"(apexone-)(?:[0-9a-f]{8}-)?(v[\d.]+)")
    new_sw = pattern.sub(lambda m: f"{m.group(1)}{content_hash}-{m.group(2)}", sw)

    if new_sw == sw:
        print("Warning: no version string matched in sw.js — check the pattern.")
        return

    with open(sw_path, "w", encoding="utf-8") as f:
        f.write(new_sw)

    print(f"sw.js stamped with content hash: {content_hash}")


def main():
    index_path = "index.html"
    sw_path = "sw.js"

    content_hash = hash_file(index_path)
    stamp_sw(sw_path, content_hash)


if __name__ == "__main__":
    main()

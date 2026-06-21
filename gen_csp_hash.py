#!/usr/bin/env python3
"""
Compute SHA-256 hashes of any inline <script> blocks in index.html.

Since the JS was extracted to src/js/main.js, index.html should have no
inline scripts — this tool is provided as a safeguard in case any inline
script is re-introduced.

Usage:
    python3 tools/gen_csp_hash.py [path/to/index.html]

If no inline scripts are found, the current CSP (script-src 'self') is correct.
If hashes are printed, update script-src in netlify.toml and the <meta CSP> tag.
"""

import hashlib
import base64
import re
import sys
import os


def compute_script_hashes(html_path: str) -> list[str]:
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Match <script> blocks without a src= attribute (inline scripts only)
    pattern = re.compile(r"<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>", re.IGNORECASE)
    scripts = pattern.findall(html)

    hashes = []
    for script in scripts:
        if not script.strip():
            continue
        digest = hashlib.sha256(script.encode("utf-8")).digest()
        b64 = base64.b64encode(digest).decode("ascii")
        hashes.append(f"'sha256-{b64}'")

    return hashes


def main():
    html_path = sys.argv[1] if len(sys.argv) > 1 else "index.html"

    if not os.path.exists(html_path):
        print(f"Error: {html_path} not found", file=sys.stderr)
        sys.exit(1)

    hashes = compute_script_hashes(html_path)

    if not hashes:
        print("No inline scripts found.")
        return

    print(f"Found {len(hashes)} inline script block(s):\n")
    for h in hashes:
        print(f"  {h}")

    csp_value = " ".join(hashes)
    print("\nReplace 'unsafe-inline' in script-src with:")
    print(f"\n  script-src {csp_value};")
    print("\nUpdate both netlify.toml and the <meta http-equiv> tag in index.html.")


if __name__ == "__main__":
    main()

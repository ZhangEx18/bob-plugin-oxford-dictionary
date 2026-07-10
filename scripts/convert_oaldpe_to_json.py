#!/usr/bin/env python3
"""Deprecated compatibility shim for the old single-file OALD converter."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    print(
        "[deprecated] scripts/convert_oaldpe_to_json.py is now a compatibility shim. "
        "Use scripts/build_oald_data.py instead.",
        file=sys.stderr,
    )
    script = Path(__file__).with_name("build_oald_data.py")
    result = subprocess.run([sys.executable, str(script), "--stage", "all"], check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Repository guard run before every commit.

Fails on the parts of the engineering standard that ESLint does not cover:
`else` branches, `var`, and source files without a purpose comment at the top.
Standard library only, so it runs anywhere Python 3 exists.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".py"}
SKIPPED_PARTS = {"node_modules", "dist", "out", ".git"}
ELSE_PATTERN = re.compile(r"^\s*}?\s*else\b")
VAR_PATTERN = re.compile(r"^\s*var\s")


def iter_source_files() -> list[pathlib.Path]:
    """Return every source file under the repository that the guard should inspect."""
    files: list[pathlib.Path] = []
    for path in ROOT.rglob("*"):
        if path.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIPPED_PARTS for part in path.parts):
            continue
        files.append(path)
    return files


def has_purpose_header(lines: list[str], suffix: str) -> bool:
    """Return whether the file opens with a comment that explains its purpose."""
    first = next((line.strip() for line in lines if line.strip() != ""), "")
    if first.startswith("#!"):
        rest = [line for line in lines[1:] if line.strip() != ""]
        first = rest[0].strip() if rest else ""
    if suffix == ".py":
        return first.startswith('"""') or first.startswith("#")
    return first.startswith("//") or first.startswith("/*")


def check_file(path: pathlib.Path) -> list[str]:
    """Return the standard violations found in one file, as human-readable lines."""
    problems: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    relative = path.relative_to(ROOT)
    if has_purpose_header(lines, path.suffix) == False:
        problems.append(f"{relative}:1: missing purpose comment at the top of the file")
    for number, line in enumerate(lines, start=1):
        if path.suffix != ".py" and ELSE_PATTERN.match(line):
            problems.append(f"{relative}:{number}: 'else' is not allowed; use a guard clause")
        if path.suffix in {".ts", ".tsx", ".js"} and VAR_PATTERN.match(line):
            problems.append(f"{relative}:{number}: 'var' is not allowed")
    return problems


def main() -> int:
    """Run every check and return a process exit code."""
    problems: list[str] = []
    for path in iter_source_files():
        problems.extend(check_file(path))
    if problems:
        print("\n".join(problems))
        print(f"\nverify: {len(problems)} problem(s)")
        return 1
    print("verify: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

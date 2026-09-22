#!/usr/bin/env python3
"""Reject likely secrets, PII, and private assessment artifacts in tracked files."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_ROOT = Path("tests/fixtures/synthetic")

FORBIDDEN_PATH_PARTS = {
    "artifacts",
    "assessment-results",
    "candidate-data",
    "career-history",
    "jev-results",
    "job-descriptions",
    "local-data",
    "outputs",
    "private",
    "profiles",
    "resumes",
}

PRIVATE_FILE_PATTERNS = (
    re.compile(r"(^|[-_.])candidate.*\.json$", re.IGNORECASE),
    re.compile(r"resume.*\.(json|pdf|docx?|pages)$", re.IGNORECASE),
    re.compile(r"career[-_. ]*history.*\.json$", re.IGNORECASE),
    re.compile(r"job[-_. ]*history.*\.json$", re.IGNORECASE),
    re.compile(r"job[-_. ]*description", re.IGNORECASE),
    re.compile(r"recommended[-_. ]*resume\.json$", re.IGNORECASE),
    re.compile(r"questionnaire.*\.json$", re.IGNORECASE),
    re.compile(r"assessment.*\.json$", re.IGNORECASE),
)

CONTENT_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "Jev credential": re.compile(
        r"JEV_API_KEY\s*(?:=|:)\s*[\"']?(?!\.\.\.|<|\$\{|your[-_ ])([A-Za-z0-9_./+=-]{12,})",
        re.IGNORECASE,
    ),
    "bearer token": re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{20,}"),
    "email address": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "US phone number": re.compile(r"(?<!\d)(?:\+?1[-. (]*)?\d{3}[-. )]*\d{3}[-. ]*\d{4}(?!\d)"),
    "US SSN": re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
}

ALLOWED_EMAIL_DOMAINS = {"example.com", "users.noreply.github.com"}


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [Path(item.decode("utf-8")) for item in result.stdout.split(b"\0") if item]


def is_synthetic(path: Path) -> bool:
    return path == SYNTHETIC_ROOT or SYNTHETIC_ROOT in path.parents


def check_synthetic_json(path: Path, errors: list[str]) -> None:
    if path.suffix.lower() != ".json":
        return
    try:
        value = json.loads((ROOT / path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{path}: invalid synthetic JSON: {exc}")
        return
    if not isinstance(value, dict) or value.get("_synthetic") is not True:
        errors.append(f"{path}: synthetic JSON must contain root marker `_synthetic: true`")


def main() -> int:
    errors: list[str] = []
    for path in tracked_files():
        if any(part.lower() in FORBIDDEN_PATH_PARTS for part in path.parts) and not is_synthetic(path):
            errors.append(f"{path}: private-data directory must not be tracked")
        if any(pattern.search(path.name) for pattern in PRIVATE_FILE_PATTERNS) and not is_synthetic(path):
            errors.append(f"{path}: likely private assessment artifact must not be tracked")
        if is_synthetic(path):
            check_synthetic_json(path, errors)

        absolute = ROOT / path
        try:
            text = absolute.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for label, pattern in CONTENT_PATTERNS.items():
            for match in pattern.finditer(text):
                if label == "email address":
                    domain = match.group(0).rsplit("@", 1)[1].lower()
                    if domain in ALLOWED_EMAIL_DOMAINS:
                        continue
                line = text.count("\n", 0, match.start()) + 1
                errors.append(f"{path}:{line}: possible {label}")

    if errors:
        print("Public-repository policy check failed:", file=sys.stderr)
        for error in sorted(set(errors)):
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Public-repository policy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

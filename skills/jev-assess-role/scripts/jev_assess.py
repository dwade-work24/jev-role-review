#!/usr/bin/env python3
"""Validate and submit paired Jev role-assessment requests."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
SUPPORTED_TYPES = {"choice", "score", "noul"}


def load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read valid JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def jev_questions(questionnaire: dict[str, Any]) -> dict[str, Any]:
    raw = questionnaire.get("questions")
    if not isinstance(raw, dict) or not raw:
        raise ValueError("questionnaire.questions must be a non-empty object")

    result: dict[str, Any] = {}
    for key, question in raw.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("every question ID must be a non-empty string")
        if not isinstance(question, dict):
            raise ValueError(f"question {key!r} must be an object")
        qtype = question.get("type")
        if qtype not in SUPPORTED_TYPES:
            raise ValueError(f"question {key!r} has unsupported type {qtype!r}")
        if not isinstance(question.get("instructions"), str):
            raise ValueError(f"question {key!r} requires instructions")

        allowed = {"type": qtype, "instructions": question["instructions"]}
        if qtype in {"choice", "score"}:
            criteria = question.get("criteria")
            if qtype == "score" and (not isinstance(criteria, list) or len(criteria) < 2):
                raise ValueError(f"score question {key!r} requires at least two criteria")
            if qtype == "choice" and (not isinstance(criteria, dict) or len(criteria) < 2):
                raise ValueError(f"choice question {key!r} requires at least two criteria")
            allowed["criteria"] = criteria
        result[key] = allowed
    return result


def build_request(model: str, view: str, candidate: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "state": {"candidate_view": view, "candidate": candidate},
        "questions": questions,
    }


def write_json(path: Path, value: Any) -> None:
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)


def call_jev(endpoint: str, api_key: str, payload: dict[str, Any], timeout: float) -> tuple[dict[str, Any], float]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # Response bodies can echo submitted candidate evidence. Do not expose them.
        exc.read()
        raise RuntimeError(f"Jev returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Jev request failed: {exc.reason}") from exc
    elapsed_ms = (time.perf_counter() - started) * 1000
    value = json.loads(response_body)
    if not isinstance(value, dict) or not isinstance(value.get("answers"), dict):
        raise RuntimeError("Jev response is missing an answers object")
    return value, elapsed_ms


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questionnaire", type=Path, required=True)
    parser.add_argument("--tailored-resume", type=Path, required=True)
    parser.add_argument("--long-form", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default=os.getenv("JEV_MODEL", "jev-latest"))
    parser.add_argument("--endpoint", default=os.getenv("JEV_API_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        questionnaire = load_object(args.questionnaire)
        tailored = load_object(args.tailored_resume)
        long_form = load_object(args.long_form)
        questions = jev_questions(questionnaire)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        args.output_dir.chmod(0o700)
    except OSError as exc:
        print(f"error: cannot secure output directory {args.output_dir}: {exc}", file=sys.stderr)
        return 2
    requests = {
        "tailored_resume": build_request(args.model, "tailored_resume", tailored, questions),
        "long_form_history": build_request(args.model, "long_form_history", long_form, questions),
    }
    for name, payload in requests.items():
        write_json(args.output_dir / f"request_{name}.json", payload)

    if args.dry_run:
        print(f"Validated inputs and wrote two Jev requests to {args.output_dir}")
        return 0

    api_key = os.getenv("JEV_API_KEY")
    if not api_key:
        print("error: JEV_API_KEY is not set; use --dry-run to prepare requests only", file=sys.stderr)
        return 2

    manifest: dict[str, Any] = {
        "model_requested": args.model,
        "endpoint": args.endpoint,
        "question_count": len(questions),
        "runs": {},
    }
    for name, payload in requests.items():
        try:
            response, elapsed_ms = call_jev(args.endpoint, api_key, payload, args.timeout)
        except (RuntimeError, json.JSONDecodeError) as exc:
            print(f"error: {name}: {exc}", file=sys.stderr)
            return 1
        write_json(args.output_dir / f"response_{name}.json", response)
        manifest["runs"][name] = {
            "elapsed_ms": round(elapsed_ms, 3),
            "model_resolved": response.get("model"),
            "usage": response.get("usage"),
        }
    write_json(args.output_dir / "manifest.json", manifest)
    print(f"Completed two Jev assessments in {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/jev-assess-role/scripts/jev_assess.py"
SPEC = importlib.util.spec_from_file_location("jev_assess", SCRIPT)
assert SPEC and SPEC.loader
JEV_ASSESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(JEV_ASSESS)


class JevAssessSecurityTests(unittest.TestCase):
    def test_write_json_uses_owner_only_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "private.json"
            JEV_ASSESS.write_json(target, {"synthetic": True})
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(json.loads(target.read_text()), {"synthetic": True})

    def test_questionnaire_ignores_synthetic_marker(self) -> None:
        questionnaire = json.loads(
            (ROOT / "tests/fixtures/synthetic/questionnaire.json").read_text(encoding="utf-8")
        )
        questions = JEV_ASSESS.jev_questions(questionnaire)
        self.assertEqual(list(questions), ["RQ-0001 | Lead software delivery"])


if __name__ == "__main__":
    unittest.main()

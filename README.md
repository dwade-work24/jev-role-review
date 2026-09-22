# Jev Role Review

Reusable Agent Skill for assessing a job description against both a tailored resume and a long-form career history with TypeSafe Jev.

The canonical skill is in `skills/jev-assess-role/`. Project discovery shims are provided for Claude Code and Codex.

## Trigger

Use a request such as:

> Jev assess this.

Then paste a job description or provide its URL. Add the candidate's long-form career-history JSON to the project. A current resume JSON is optional but recommended.

## Configuration

Set the Jev credential outside source control:

```bash
export JEV_API_KEY="..."
```

Optional overrides:

```bash
export JEV_MODEL="jev-latest"
export JEV_API_URL="https://api.typesafe.ai/v1/systemone"
```

Without a key, the workflow can still generate and validate both request packages using `--dry-run`.

See [SKILLS.md](SKILLS.md) for package layout and compatibility.

# Skills

## jev-assess-role

Trigger with “Jev assess this” after pasting a job description or providing its URL.

The skill:

1. creates a traceable Jev questionnaire from the job description;
2. creates an evidence-grounded recommended-resume JSON;
3. evaluates the recommended resume and long-form career history with the same Jev questions;
4. distinguishes presentation gaps from true experience gaps; and
5. returns a brief decision summary plus the underlying JSON artifacts.

The canonical Agent Skills package is [skills/jev-assess-role](skills/jev-assess-role).

### Compatibility

- Claude Code discovers the project shim at `.claude/skills/jev-assess-role/SKILL.md` and invokes it as `/jev-assess-role`.
- Codex discovers the project shim at `.codex/skills/jev-assess-role/SKILL.md` and invokes it as `$jev-assess-role`.
- Both shims direct the agent to the same canonical skill, scripts, and schemas to avoid divergent behavior.

The canonical `SKILL.md` uses only portable Agent Skills frontmatter: `name` and `description`. OpenAI-specific UI metadata is isolated in `agents/openai.yaml`.

### Required project input

Add the candidate’s long-form career-history JSON to the job project. A current resume JSON may also be included as a starting point.

### Jev access

Set `JEV_API_KEY` in the execution environment. Do not store the key in the project or repository. If the key is unavailable, the skill prepares validated request files with `--dry-run` and reports that no live assessment was run.

### Privacy boundary

The public package contains synthetic fixtures only. Real job descriptions, career records, resumes, questionnaires, request payloads, and Jev responses are runtime data. Keep them in ignored local paths or private hosted storage, never in this repository or CI artifacts. Logs may include request IDs, status, timing, model, and usage metadata, but not source or response content.

---
name: jev-assess-role
description: Assess a pasted or linked job description with TypeSafe Jev against both a tailored resume and a long-form career history. Use when the user says "Jev assess this," "run Jev," "assess this role," or asks for a Jev questionnaire, evidence-based resume edits, dual Jev comparison, fit gaps, or qualification summary. Produce grounded JSON artifacts, call Jev when credentials are available, and summarize the comparison without inventing candidate evidence.
---

# Jev role assessment

Run a repeatable, evidence-grounded assessment of one job description against two candidate views:

1. a concise, role-tailored resume; and
2. the complete long-form career history.

Read [references/schemas.md](references/schemas.md) before creating artifacts. Use `scripts/jev_assess.py` to validate packages and submit both assessments.

## Workflow

1. Resolve the job description.
   - Prefer text pasted in the current conversation.
   - If the user supplies a URL, retrieve the current posting and preserve its URL and retrieval date.
   - Do not mix facts from similar postings.

2. Resolve candidate sources from the current project.
   - Require the long-form career-history JSON.
   - Use the current base-resume JSON when present; otherwise derive a resume JSON only from the long-form history.
   - Treat source files as authoritative over conversational memory.
   - Ask for a missing source only when the project does not contain enough evidence to proceed.

3. Create the questionnaire.
   - Convert each material responsibility and qualification into one independent question.
   - Preserve explicit required/preferred distinctions.
   - Use stable IDs such as `RQ-0001` and `PF-0001`.
   - Prefer `score` with a concrete 0–2 legend for evidence strength; use `noul` only for genuinely binary requirements and `choice` only for mutually exclusive categories.
   - Keep criteria factual and observable. Do not add qualifications absent from the posting.

4. Create the recommended-resume JSON.
   - Select and reorder only facts supported by the long-form career history.
   - Record every proposed wording change in `suggested_edits` with source evidence.
   - Mark unsupported or ambiguous claims as gaps; never infer that adjacent experience proves a requirement.
   - Keep the result usable as a resume, not as an exhaustive biography.

5. Validate and run both Jev assessments.
   - Save `questionnaire.json`, `recommended_resume.json`, and the unchanged long-form JSON.
   - Run:

     ```bash
     python3 scripts/jev_assess.py \
       --questionnaire questionnaire.json \
       --tailored-resume recommended_resume.json \
       --long-form candidate_long_form.json \
       --output-dir jev-results
     ```

   - The script validates the input contract, writes the two request payloads, and calls Jev using `JEV_API_KEY`.
   - If `JEV_API_KEY` is unavailable, rerun with `--dry-run`; clearly state that the packages were prepared but not submitted.
   - Never expose or commit credentials.

6. Analyze the paired results.
   - Compare answers by question ID.
   - Distinguish `resume-visible fit` from `underlying career fit`.
   - Flag `presentation gaps` where the long-form result exceeds the tailored-resume result.
   - Flag `true experience gaps` where both results are weak.
   - Flag `possible overstatement` where the tailored-resume result materially exceeds the long-form result.
   - Treat low confidence as uncertainty, not proof.

7. Present a brief result first.
   - Overall view: strong, credible, mixed, or weak fit.
   - A compact required/preferred score summary.
   - The three strongest matches.
   - The three largest gaps or risks.
   - The most valuable factual resume edits.
   - Links or paths to all JSON artifacts and raw Jev responses.

## Guardrails

- Use the same questionnaire, model, and wording for both candidate states.
- Do not let the tailored resume alter the long-form source.
- Preserve Jev probabilities, confidence, model identifier, timing, and usage exactly as returned.
- Do not collapse a missing resume statement into missing career experience.
- Do not make an overall hiring decision; report evidence coverage and uncertainty.
- If the job description conflicts with a recruiter-provided clarification, show the conflict instead of silently choosing one.

# Jev role assessment contracts

Use JSON objects with UTF-8 text and stable question IDs. Additional metadata is allowed, but do not rename the required keys below.

## `questionnaire.json`

```json
{
  "schema_version": "1.0",
  "job": {
    "title": "Role title",
    "company": "Company",
    "source_url": null,
    "description": "Complete normalized job description"
  },
  "questions": {
    "RQ-0001 | Human-readable qualification": {
      "type": "score",
      "instructions": "Evaluate only explicit candidate evidence for this qualification.",
      "criteria": [
        "No documented evidence.",
        "Related or partial evidence, but the qualification is incomplete or indirect.",
        "Direct, substantive evidence that satisfies the qualification."
      ],
      "requirement_level": "required",
      "source_text": "Exact or faithfully normalized job requirement"
    }
  }
}
```

`requirement_level` is `required`, `preferred`, or `responsibility`. Jev receives only supported question fields (`type`, `instructions`, and `criteria`); the remaining fields stay in the local questionnaire for traceability.

## `recommended_resume.json`

```json
{
  "schema_version": "1.0",
  "candidate": {"name": "Candidate name"},
  "target_role": {"title": "Role title", "company": "Company"},
  "summary": "Evidence-grounded professional summary",
  "competencies": ["Relevant competency"],
  "experience": [
    {
      "company": "Company",
      "title": "Title",
      "dates": "Dates",
      "bullets": [
        {
          "text": "Resume bullet",
          "evidence_refs": ["Stable path or source record identifier"]
        }
      ]
    }
  ],
  "education": [],
  "suggested_edits": [
    {
      "section": "experience",
      "change": "add|revise|remove|reorder",
      "proposed_text": "Exact proposed wording",
      "reason": "Relevant qualification addressed",
      "evidence_refs": ["Stable source reference"],
      "confidence": "high|medium|low"
    }
  ],
  "gaps": [
    {
      "question_id": "RQ-0001",
      "status": "unsupported|ambiguous|not-resume-worthy",
      "note": "Why the requirement should not be claimed"
    }
  ]
}
```

## Jev request

Submit two requests with identical `model` and `questions`. Change only `state`:

```json
{
  "model": "jev-latest",
  "state": {"candidate_view": "tailored_resume", "candidate": {}},
  "questions": {}
}
```

The second request uses `candidate_view: long_form_history` and the unchanged career-history JSON.

## Comparison rules

For a 0–2 score question, calculate `delta = long_form_score - tailored_resume_score`.

- `delta >= 0.75`: presentation gap
- both scores `< 1.0`: likely experience gap
- `delta <= -0.75`: possible overstatement; inspect evidence before concluding
- confidence `< 0.60`: uncertain result; avoid strong conclusions

Do not aggregate unlike question types into a single percentage without documenting the normalization method.


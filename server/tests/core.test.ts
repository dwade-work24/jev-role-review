import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthContext } from "../src/auth/context.js";
import type { JevAssessmentRequest, JevAssessmentResponse, JevClient } from "../src/jev/client.js";
import { HttpJevClient, JevUpstreamError } from "../src/jev/client.js";
import { InMemoryProfileStore } from "../src/profile/store.js";
import { RunDualAssessmentInputSchema } from "../src/domain/schemas.js";
import { getCandidateProfile } from "../src/tools/get-candidate-profile.js";
import { DualAssessmentError, runDualAssessment } from "../src/tools/run-dual-assessment.js";

async function fixture(name: string): Promise<Record<string, unknown>> {
  const url = new URL(`../../tests/fixtures/synthetic/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as Record<string, unknown>;
}

const subject = "synthetic-user";
const auth: AuthContext = {
  subject,
  scopes: new Set(["profile:read", "assessment:run"]),
};

class RecordingJevClient implements JevClient {
  readonly requests: JevAssessmentRequest[] = [];
  readonly #failView: string | undefined;

  constructor(failView?: string) {
    this.#failView = failView;
  }

  async assess(request: JevAssessmentRequest): Promise<JevAssessmentResponse> {
    this.requests.push(structuredClone(request));
    if (request.state.candidate_view === this.#failView) {
      throw new Error("synthetic upstream failure containing private candidate text");
    }
    return {
      model: request.model,
      answers: { synthetic_answer: request.state.candidate_view },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
}

async function setup() {
  const profileStore = new InMemoryProfileStore();
  const profile = await fixture("long_form_history.json");
  const record = await profileStore.put(subject, "synthetic-v1", profile);
  return { profileStore, profile, record };
}

test("get_candidate_profile returns the scoped current profile", async () => {
  const { profileStore, profile, record } = await setup();
  const result = await getCandidateProfile(auth, profileStore);
  assert.equal(result.version, "synthetic-v1");
  assert.equal(result.sha256, record.sha256);
  assert.deepEqual(result.profile, profile);
});

test("profile access requires the profile:read scope", async () => {
  const { profileStore } = await setup();
  await assert.rejects(
    getCandidateProfile({ subject, scopes: new Set() }, profileStore),
    { name: "AuthorizationError" },
  );
});

test("dual-assessment input rejects an empty question set", () => {
  assert.throws(
    () => RunDualAssessmentInputSchema.parse({
      questionnaire: { questions: {} },
      tailored_resume: { _synthetic: true },
    }),
    { name: "ZodError" },
  );
});

test("documented production acceptance input is valid and fully synthetic", async () => {
  const url = new URL("../examples/mcp-dual-input.json", import.meta.url);
  const raw = JSON.parse(await readFile(url, "utf8")) as Record<string, unknown>;
  const input = RunDualAssessmentInputSchema.parse(raw);
  assert.equal(input.questionnaire._synthetic, true);
  assert.equal(input.tailored_resume._synthetic, true);
  assert.equal(Object.keys(input.questionnaire.questions).length, 5);
});

test("run_dual_assessment sends identical questions and model with two candidate views", async () => {
  const { profileStore, profile, record } = await setup();
  const questionnaire = await fixture("questionnaire.json");
  const tailoredResume = await fixture("recommended_resume.json");
  const client = new RecordingJevClient();
  const result = await runDualAssessment(
    {
      questionnaire: questionnaire as never,
      tailored_resume: tailoredResume,
      profile_version: "synthetic-v1",
      model: "jev-synthetic",
    },
    auth,
    profileStore,
    client,
  );

  assert.equal(client.requests.length, 2);
  const [tailoredRequest, longFormRequest] = client.requests;
  assert.ok(tailoredRequest);
  assert.ok(longFormRequest);
  assert.equal(tailoredRequest.model, longFormRequest.model);
  assert.deepEqual(tailoredRequest.questions, longFormRequest.questions);
  assert.equal(tailoredRequest.state.candidate_view, "tailored_resume");
  assert.equal(longFormRequest.state.candidate_view, "long_form_history");
  assert.deepEqual(tailoredRequest.state.candidate, tailoredResume);
  assert.deepEqual(longFormRequest.state.candidate, profile);
  assert.equal(result.profile.sha256, record.sha256);
  assert.equal(result.model_requested, "jev-synthetic");
  assert.equal(
    (result.runs.tailored_resume.response.answers as Record<string, unknown>).synthetic_answer,
    "tailored_resume",
  );
  assert.equal(
    (result.runs.long_form_history.response.answers as Record<string, unknown>).synthetic_answer,
    "long_form_history",
  );
});

test("profile version mismatch stops both Jev calls", async () => {
  const { profileStore } = await setup();
  const client = new RecordingJevClient();
  await assert.rejects(
    runDualAssessment(
      {
        questionnaire: await fixture("questionnaire.json") as never,
        tailored_resume: await fixture("recommended_resume.json"),
        profile_version: "stale-version",
        model: "jev-synthetic",
      },
      auth,
      profileStore,
      client,
    ),
    { name: "ProfileVersionMismatchError" },
  );
  assert.equal(client.requests.length, 0);
});

test("partial upstream failure returns a generic error with a request ID", async () => {
  const { profileStore } = await setup();
  const client = new RecordingJevClient("long_form_history");
  let caught: unknown;
  try {
    await runDualAssessment(
      {
        questionnaire: await fixture("questionnaire.json") as never,
        tailored_resume: await fixture("recommended_resume.json"),
        model: "jev-synthetic",
      },
      auth,
      profileStore,
      client,
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DualAssessmentError);
  assert.match(caught.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(caught.message, "One or more Jev assessments failed");
  assert.deepEqual(caught.failures, [{ view: "long_form_history", kind: "unexpected" }]);
  assert.doesNotMatch(caught.message, /private text/i);
});

test("HttpJevClient never exposes an upstream response body", async () => {
  const client = new HttpJevClient({
    apiKey: "synthetic-key",
    fetchImplementation: async () => new Response(
      "private candidate evidence that must not escape",
      { status: 500 },
    ),
  });
  await assert.rejects(
    client.assess({
      model: "jev-synthetic",
      state: { candidate_view: "tailored_resume", candidate: { _synthetic: true } },
      questions: {
        synthetic: { type: "noul", instructions: "Return a synthetic answer." },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof JevUpstreamError);
      assert.equal(error.message, "Jev returned HTTP 500");
      assert.equal(error.kind, "http");
      assert.equal(error.status, 500);
      assert.doesNotMatch(error.message, /private candidate evidence/i);
      return true;
    },
  );
});

test("HttpJevClient invokes an injected fetch without an object receiver", async () => {
  let observedReceiver: unknown = "not-called";
  const client = new HttpJevClient({
    apiKey: "  synthetic-key  ",
    fetchImplementation: async function (this: unknown, _input, init) {
      observedReceiver = this;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer synthetic-key");
      return Response.json({ answers: { synthetic: true } });
    },
  });

  await client.assess({
    model: "jev-synthetic",
    state: { candidate_view: "tailored_resume", candidate: { _synthetic: true } },
    questions: {
      synthetic: { type: "noul", instructions: "Return a synthetic answer." },
    },
  });

  assert.equal(observedReceiver, undefined);
});

import { requireScope, type AuthContext } from "../auth/context.js";
import { sha256Json } from "../domain/json.js";
import {
  DualAssessmentOutputSchema,
  RunDualAssessmentInputSchema,
  type DualAssessmentOutput,
  type RunDualAssessmentInput,
} from "../domain/schemas.js";
import {
  buildJevRequest,
  JevUpstreamError,
  type CandidateView,
  type JevAssessmentResponse,
  type JevClient,
  type JevUpstreamFailureKind,
} from "../jev/client.js";
import {
  ProfileNotFoundError,
  ProfileVersionMismatchError,
  type ProfileStore,
} from "../profile/store.js";

export class DualAssessmentError extends Error {
  readonly requestId: string;
  readonly failures: readonly DualAssessmentFailure[];

  constructor(requestId: string, failures: readonly DualAssessmentFailure[]) {
    super("One or more Jev assessments failed");
    this.name = "DualAssessmentError";
    this.requestId = requestId;
    this.failures = failures;
  }
}

export interface DualAssessmentFailure {
  readonly view: CandidateView;
  readonly kind: JevUpstreamFailureKind | "unexpected";
  readonly status?: number;
}

export interface AssessmentRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export class AssessmentRateLimitError extends Error {
  constructor() {
    super("Assessment rate limit exceeded");
    this.name = "AssessmentRateLimitError";
  }
}

function validateAnswers(response: JevAssessmentResponse, questions: RunDualAssessmentInput["questionnaire"]["questions"]): void {
  const expected = Object.keys(questions);
  const actual = Object.keys(response.answers);
  if (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(response.answers, key))) {
    throw new JevUpstreamError("invalid_response");
  }
  for (const key of expected) {
    const question = questions[key];
    const answer = response.answers[key];
    if (!question || typeof answer !== "object" || answer === null || Array.isArray(answer)
      || (answer as Record<string, unknown>).type !== question.type) {
      throw new JevUpstreamError("invalid_response");
    }
    if (question.type === "score") {
      const score = (answer as Record<string, unknown>).score;
      if (typeof score !== "number" || !Number.isFinite(score)
        || score < 0 || score > question.criteria.length - 1) {
        throw new JevUpstreamError("invalid_response");
      }
    }
  }
}

function sanitizedFailure(view: CandidateView, reason: unknown): DualAssessmentFailure {
  if (!(reason instanceof JevUpstreamError)) return { view, kind: "unexpected" };
  return reason.status === undefined
    ? { view, kind: reason.kind }
    : { view, kind: reason.kind, status: reason.status };
}

async function timedAssessment(
  client: JevClient,
  request: Parameters<JevClient["assess"]>[0],
): Promise<{ elapsed_ms: number; response: JevAssessmentResponse }> {
  const started = performance.now();
  const response = await client.assess(request);
  validateAnswers(response, request.questions);
  return {
    elapsed_ms: Math.round((performance.now() - started) * 1_000) / 1_000,
    response,
  };
}

export async function runDualAssessment(
  rawInput: RunDualAssessmentInput,
  context: AuthContext,
  profileStore: ProfileStore,
  jevClient: JevClient,
  rateLimiter?: AssessmentRateLimiter,
): Promise<DualAssessmentOutput> {
  requireScope(context, "assessment:run");
  const input = RunDualAssessmentInputSchema.parse(rawInput);
  const profile = await profileStore.getCurrent(context.subject);
  if (profile === null) throw new ProfileNotFoundError();
  if (input.profile_version !== undefined && input.profile_version !== profile.version) {
    throw new ProfileVersionMismatchError();
  }

  if (rateLimiter && !(await rateLimiter.limit({ key: context.subject })).success) {
    throw new AssessmentRateLimitError();
  }

  const requestId = crypto.randomUUID();
  const questions = input.questionnaire.questions;
  const tailoredRequest = buildJevRequest(
    input.model,
    "tailored_resume",
    input.tailored_resume,
    questions,
  );
  const longFormRequest = buildJevRequest(
    input.model,
    "long_form_history",
    profile.profile,
    questions,
  );

  const [tailored, longForm] = await Promise.allSettled([
    timedAssessment(jevClient, tailoredRequest),
    timedAssessment(jevClient, longFormRequest),
  ]);
  if (tailored.status === "rejected" || longForm.status === "rejected") {
    const failures: DualAssessmentFailure[] = [];
    if (tailored.status === "rejected") {
      failures.push(sanitizedFailure("tailored_resume", tailored.reason));
    }
    if (longForm.status === "rejected") {
      failures.push(sanitizedFailure("long_form_history", longForm.reason));
    }
    throw new DualAssessmentError(requestId, failures);
  }

  return DualAssessmentOutputSchema.parse({
    request_id: requestId,
    model_requested: input.model,
    questionnaire_sha256: await sha256Json(questions),
    profile: { version: profile.version, sha256: profile.sha256 },
    runs: {
      tailored_resume: tailored.value,
      long_form_history: longForm.value,
    },
  });
}

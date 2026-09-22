import { requireScope, type AuthContext } from "../auth/context.js";
import { sha256Json } from "../domain/json.js";
import {
  DualAssessmentOutputSchema,
  RunDualAssessmentInputSchema,
  type DualAssessmentOutput,
  type RunDualAssessmentInput,
} from "../domain/schemas.js";
import { buildJevRequest, type JevAssessmentResponse, type JevClient } from "../jev/client.js";
import {
  ProfileNotFoundError,
  ProfileVersionMismatchError,
  type ProfileStore,
} from "../profile/store.js";

export class DualAssessmentError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super("One or more Jev assessments failed");
    this.name = "DualAssessmentError";
    this.requestId = requestId;
  }
}

async function timedAssessment(
  client: JevClient,
  request: Parameters<JevClient["assess"]>[0],
): Promise<{ elapsed_ms: number; response: JevAssessmentResponse }> {
  const started = performance.now();
  const response = await client.assess(request);
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
): Promise<DualAssessmentOutput> {
  requireScope(context, "assessment:run");
  const input = RunDualAssessmentInputSchema.parse(rawInput);
  const profile = await profileStore.getCurrent(context.subject);
  if (profile === null) throw new ProfileNotFoundError();
  if (input.profile_version !== undefined && input.profile_version !== profile.version) {
    throw new ProfileVersionMismatchError();
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
    throw new DualAssessmentError(requestId);
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

import { z } from "zod";
import {
  JevQuestionsSchema,
  JsonObjectSchema,
  type JevQuestions,
  type JsonObject,
} from "../domain/schemas.js";

export const CandidateViewSchema = z.enum(["tailored_resume", "long_form_history"]);

export const JevAssessmentRequestSchema = z.object({
  model: z.string().trim().min(1).max(200),
  state: z.object({
    candidate_view: CandidateViewSchema,
    candidate: JsonObjectSchema,
  }).strict(),
  questions: JevQuestionsSchema,
}).strict();

export const JevAssessmentResponseSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  model: z.string().optional(),
  usage: z.unknown().optional(),
}).passthrough();

export type CandidateView = z.infer<typeof CandidateViewSchema>;
export type JevAssessmentRequest = z.infer<typeof JevAssessmentRequestSchema>;
export type JevAssessmentResponse = z.infer<typeof JevAssessmentResponseSchema>;

export interface JevClient {
  assess(request: JevAssessmentRequest, signal?: AbortSignal): Promise<JevAssessmentResponse>;
}

export interface HttpJevClientOptions {
  readonly endpoint?: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export class JevUpstreamError extends Error {
  constructor(message = "Jev assessment failed") {
    super(message);
    this.name = "JevUpstreamError";
  }
}

export class HttpJevClient implements JevClient {
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: HttpJevClientOptions) {
    if (!options.apiKey.trim()) throw new Error("A Jev API key is required");
    this.#endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async assess(request: JevAssessmentRequest, signal?: AbortSignal): Promise<JevAssessmentResponse> {
    const payload = JevAssessmentRequestSchema.parse(request);
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const combinedSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });
    } catch (error) {
      throw new JevUpstreamError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Jev assessment timed out"
          : undefined,
      );
    }
    if (!response.ok) {
      // The body may echo submitted evidence, so it is deliberately ignored.
      throw new JevUpstreamError(`Jev returned HTTP ${response.status}`);
    }
    try {
      return JevAssessmentResponseSchema.parse(await response.json());
    } catch {
      throw new JevUpstreamError("Jev returned an invalid response");
    }
  }
}

export function buildJevRequest(
  model: string,
  candidateView: CandidateView,
  candidate: JsonObject,
  questions: JevQuestions,
): JevAssessmentRequest {
  return JevAssessmentRequestSchema.parse({
    model,
    state: { candidate_view: candidateView, candidate },
    questions,
  });
}

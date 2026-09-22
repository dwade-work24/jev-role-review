import { z } from "zod";

export const JsonObjectSchema = z.record(z.string(), z.unknown());

const QuestionBaseSchema = z.object({
  instructions: z.string().trim().min(1).max(20_000),
});

const ScoreQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("score"),
  criteria: z.array(z.string().trim().min(1).max(4_000)).min(2).max(25),
}).strict();

const ChoiceQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("choice"),
  criteria: z.record(z.string().trim().min(1), z.string().trim().min(1).max(4_000)),
}).strict().superRefine((question, context) => {
  if (Object.keys(question.criteria).length < 2) {
    context.addIssue({
      code: "custom",
      message: "choice questions require at least two criteria",
      path: ["criteria"],
    });
  }
});

const NoulQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal("noul"),
}).strict();

export const JevQuestionSchema = z.union([
  ScoreQuestionSchema,
  ChoiceQuestionSchema,
  NoulQuestionSchema,
]);

export const JevQuestionsSchema = z.record(
  z.string().trim().min(1).max(500),
  JevQuestionSchema,
).refine((questions) => Object.keys(questions).length > 0, {
  message: "questions must not be empty",
});

export const QuestionnaireSchema = z.object({
  questions: JevQuestionsSchema,
}).passthrough();

export const GetCandidateProfileInputSchema = z.object({}).strict();

export const CandidateProfileOutputSchema = z.object({
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  profile: JsonObjectSchema,
}).strict();

export const RunDualAssessmentInputSchema = z.object({
  questionnaire: QuestionnaireSchema,
  tailored_resume: JsonObjectSchema,
  profile_version: z.string().trim().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(200).default("jev-latest"),
}).strict();

const JevRunOutputSchema = z.object({
  elapsed_ms: z.number().nonnegative(),
  response: JsonObjectSchema,
}).strict();

export const DualAssessmentOutputSchema = z.object({
  request_id: z.string().uuid(),
  model_requested: z.string().min(1),
  questionnaire_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  profile: z.object({
    version: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  runs: z.object({
    tailored_resume: JevRunOutputSchema,
    long_form_history: JevRunOutputSchema,
  }).strict(),
}).strict();

export type JsonObject = z.infer<typeof JsonObjectSchema>;
export type JevQuestions = z.infer<typeof JevQuestionsSchema>;
export type CandidateProfileOutput = z.infer<typeof CandidateProfileOutputSchema>;
export type RunDualAssessmentInput = z.infer<typeof RunDualAssessmentInputSchema>;
export type DualAssessmentOutput = z.infer<typeof DualAssessmentOutputSchema>;

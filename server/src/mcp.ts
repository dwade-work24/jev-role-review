import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthContextResolver } from "./auth/context.js";
import {
  CandidateProfileOutputSchema,
  DualAssessmentOutputSchema,
  GetCandidateProfileInputSchema,
  RunDualAssessmentInputSchema,
} from "./domain/schemas.js";
import type { JevClient } from "./jev/client.js";
import type { ProfileStore } from "./profile/store.js";
import { getCandidateProfile } from "./tools/get-candidate-profile.js";
import { runDualAssessment } from "./tools/run-dual-assessment.js";

export interface MetadataLogger {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
  error(event: string, fields: Readonly<Record<string, unknown>>): void;
}

const silentLogger: MetadataLogger = {
  info: () => undefined,
  error: () => undefined,
};

export interface JevMcpDependencies {
  readonly profileStore: ProfileStore;
  readonly jevClient: JevClient;
  readonly resolveAuthContext: AuthContextResolver;
  readonly logger?: MetadataLogger;
}

function safeError(error: unknown): { name: string; request_id?: string } {
  if (!(error instanceof Error)) return { name: "Error" };
  const requestId = "requestId" in error && typeof error.requestId === "string"
    ? error.requestId
    : undefined;
  return requestId === undefined
    ? { name: error.name }
    : { name: error.name, request_id: requestId };
}

export function createJevMcpServer(dependencies: JevMcpDependencies): McpServer {
  const logger = dependencies.logger ?? silentLogger;
  const server = new McpServer(
    { name: "jev-role-review", version: "0.1.0" },
    {
      instructions:
        "Use get_candidate_profile to inspect the authenticated account's authoritative profile. Use run_dual_assessment to compare one questionnaire against both a tailored resume and that profile. Never request or transmit a Jev API key as a tool argument.",
    },
  );

  server.registerTool(
    "get_candidate_profile",
    {
      title: "Get candidate profile",
      description:
        "Return the authenticated account's current authoritative candidate profile, version, and SHA-256 digest.",
      inputSchema: GetCandidateProfileInputSchema.shape,
      outputSchema: CandidateProfileOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (_input, requestContext) => {
      try {
        const auth = await dependencies.resolveAuthContext(requestContext);
        const result = await getCandidateProfile(auth, dependencies.profileStore);
        logger.info("profile_read", { profile_version: result.version });
        return {
          structuredContent: result,
          content: [{ type: "text", text: `Loaded candidate profile version ${result.version}.` }],
        };
      } catch (error) {
        const safe = safeError(error);
        logger.error("profile_read_failed", safe);
        return {
          isError: true,
          content: [{ type: "text", text: "Candidate profile could not be loaded." }],
        };
      }
    },
  );

  server.registerTool(
    "run_dual_assessment",
    {
      title: "Run dual Jev assessment",
      description:
        "Assess the same questionnaire twice: once against a supplied tailored resume and once against the authenticated account's authoritative long-form career profile.",
      inputSchema: RunDualAssessmentInputSchema.shape,
      outputSchema: DualAssessmentOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, requestContext) => {
      try {
        const auth = await dependencies.resolveAuthContext(requestContext);
        const result = await runDualAssessment(
          input,
          auth,
          dependencies.profileStore,
          dependencies.jevClient,
        );
        logger.info("dual_assessment_completed", {
          request_id: result.request_id,
          profile_version: result.profile.version,
        });
        return {
          structuredContent: result,
          content: [{
            type: "text",
            text: `Completed both Jev assessments for request ${result.request_id}.`,
          }],
        };
      } catch (error) {
        const safe = safeError(error);
        logger.error("dual_assessment_failed", safe);
        return {
          isError: true,
          content: [{
            type: "text",
            text: safe.request_id === undefined
              ? "The dual assessment could not be completed."
              : `The dual assessment could not be completed. Request: ${safe.request_id}.`,
          }],
        };
      }
    },
  );

  return server;
}

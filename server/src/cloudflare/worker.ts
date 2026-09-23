import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp/server";
import { HttpJevClient } from "../jev/client.js";
import { createJevMcpServer } from "../mcp.js";
import { CloudflareKvProfileStore } from "../profile/store.js";
import type { CloudflareEnv, McpAuthProps } from "./env.js";
import { isCurrentAllowlistedGrant } from "./allowed-account.js";
import { mcpScopes, oauthApplicationHandler } from "./oauth.js";

class McpApiHandler extends WorkerEntrypoint<CloudflareEnv, McpAuthProps> {
  override async fetch(request: Request): Promise<Response> {
    const props = this.ctx.props;
    // A changed allowlist immediately invalidates grants issued under the old one.
    // Grants issued before this binding was introduced fail closed until reauthorization.
    if (!(await isCurrentAllowlistedGrant(props, this.env.ALLOWED_GOOGLE_EMAIL, this.env.COOKIE_ENCRYPTION_KEY))) {
      return new Response("Authorization expired. Please sign in again.", {
        status: 401,
        headers: { "cache-control": "no-store" },
      });
    }
    const handler = createMcpHandler(
      () => createJevMcpServer({
        profileStore: new CloudflareKvProfileStore(this.env.PROFILE_KV),
        jevClient: new HttpJevClient({
          apiKey: this.env.JEV_API_KEY,
          ...(this.env.JEV_API_URL === undefined ? {} : { endpoint: this.env.JEV_API_URL }),
        }),
        // Missing production configuration must never silently disable cost protection.
        assessmentRateLimiter: this.env.ASSESSMENT_RATE_LIMITER ?? {
          limit: async () => ({ success: false }),
        },
        resolveAuthContext: () => ({
          subject: props.subject,
          scopes: new Set(props.scopes),
        }),
        logger: {
          info: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
          error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
        },
      }),
      {
        route: "/mcp",
        authContext: { props },
        corsOptions: false,
      },
    );
    return handler(request, this.env, this.ctx);
  }
}

export default new OAuthProvider<CloudflareEnv>({
  apiRoute: "/mcp",
  apiHandler: McpApiHandler,
  defaultHandler: oauthApplicationHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: mcpScopes,
  resourceMetadata: {
    scopes_supported: mcpScopes,
    bearer_methods_supported: ["header"],
    resource_name: "Private Jev role review MCP server",
  },
});

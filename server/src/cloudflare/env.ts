import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface McpAuthProps {
  readonly [key: string]: unknown;
  readonly subject: string;
  readonly scopes: string[];
}

export interface CloudflareEnv {
  readonly OAUTH_KV: KVNamespace;
  readonly PROFILE_KV: KVNamespace;
  readonly OAUTH_PROVIDER: OAuthHelpers;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly ALLOWED_GOOGLE_EMAIL: string;
  readonly COOKIE_ENCRYPTION_KEY: string;
  readonly JEV_API_KEY: string;
  readonly JEV_API_URL?: string;
}

import {
  AuthorizationError,
  type AuthRequest,
  type ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import type { CloudflareEnv } from "./env.js";
import { allowedAccountFingerprint } from "./allowed-account.js";
import { exchangeGoogleCode, googleAuthorizationUrl } from "./google.js";
import { sealState, unsealState } from "./signed-state.js";

const FLOW_TTL_SECONDS = 600;
const SUPPORTED_SCOPES = new Set(["profile:read", "assessment:run"]);
const CSRF_COOKIE = "__Host-CSRF_TOKEN";
const CONSENT_STATE_COOKIE = "__Host-MCP_CONSENT_STATE";
const GOOGLE_STATE_COOKIE = "__Host-GOOGLE_OAUTH_STATE";

const AuthRequestSchema = z.object({
  responseType: z.string(),
  clientId: z.string(),
  redirectUri: z.string().url(),
  scope: z.array(z.string()),
  state: z.string(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.string().optional(),
  resource: z.union([z.string(), z.array(z.string())]).optional(),
  issuer: z.string().optional(),
}).strip();

const ConsentStateSchema = z.object({
  oauthRequest: AuthRequestSchema,
  csrfHash: z.string(),
}).strict();

const GoogleStateSchema = z.object({
  oauthRequest: AuthRequestSchema,
  state: z.string(),
  nonce: z.string(),
}).strict();

function storedAuthRequest(value: z.infer<typeof AuthRequestSchema>): AuthRequest {
  return {
    responseType: value.responseType,
    clientId: value.clientId,
    redirectUri: value.redirectUri,
    scope: value.scope,
    state: value.state,
    ...(value.codeChallenge === undefined ? {} : { codeChallenge: value.codeChallenge }),
    ...(value.codeChallengeMethod === undefined
      ? {}
      : { codeChallengeMethod: value.codeChallengeMethod }),
    ...(value.resource === undefined ? {} : { resource: value.resource }),
    ...(value.issuer === undefined ? {} : { issuer: value.issuer }),
  };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return undefined;
}

function setCookie(name: string, value: string, maxAge = FLOW_TTL_SECONDS): string {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return setCookie(name, "", 0);
}

function responseWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function errorResponse(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function oauthErrorRedirect(request: AuthRequest, code: string, description: string): Response {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", code);
  redirect.searchParams.set("error_description", description);
  if (request.state) redirect.searchParams.set("state", request.state);
  if (request.issuer) redirect.searchParams.set("iss", request.issuer);
  return responseWithCookies(redirect.toString(), [
    clearCookie(CSRF_COOKIE),
    clearCookie(CONSENT_STATE_COOKIE),
    clearCookie(GOOGLE_STATE_COOKIE),
  ]);
}

function grantedScopes(requested: string[]): string[] {
  return requested.filter((scope) => SUPPORTED_SCOPES.has(scope));
}

function consentPage(client: ClientInfo, request: AuthRequest, csrf: string): string {
  const clientName = escapeHtml(client.clientName?.trim() || "An MCP client");
  const destination = escapeHtml(request.redirectUri);
  const scopeItems = request.scope
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Authorize Jev role review</title>
<style>body{font:16px system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;line-height:1.5}button{padding:.65rem 1rem;margin-right:.5rem}code{background:#eee;padding:.15rem .3rem}</style>
</head><body><main><h1>Authorize Jev role review</h1>
<p><strong>${clientName}</strong> is requesting access to this private MCP server.</p>
<p>After approval, your browser will return to <strong>${destination}</strong>. Check that you recognize this destination before continuing.</p>
<ul>${scopeItems}</ul>
<p>You will next sign in with the single Google account allowed by the server configuration.</p>
<form method="post" action="/authorize">
<input type="hidden" name="csrf_token" value="${escapeHtml(csrf)}">
<button type="submit" name="decision" value="approve">Continue with Google</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form></main></body></html>`;
}

async function parseAuthorizationRequest(request: Request, env: CloudflareEnv): Promise<AuthRequest | Response> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return errorResponse(error.description);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return responseWithCookies(redirect.toString(), []);
  }
}

async function showConsent(request: Request, env: CloudflareEnv): Promise<Response> {
  const parsed = await parseAuthorizationRequest(request, env);
  if (parsed instanceof Response) return parsed;
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (client === null) return errorResponse("Unknown OAuth client");

  const csrf = randomToken();
  const consentState = await sealState(
    { oauthRequest: parsed, csrfHash: await sha256Text(csrf) },
    env.COOKIE_ENCRYPTION_KEY,
    FLOW_TTL_SECONDS,
  );
  const headers = new Headers({
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  headers.append("set-cookie", setCookie(CSRF_COOKIE, csrf));
  headers.append("set-cookie", setCookie(CONSENT_STATE_COOKIE, consentState));
  return new Response(consentPage(client, parsed, csrf), { headers });
}

async function submitConsent(request: Request, env: CloudflareEnv): Promise<Response> {
  const form = await request.formData();
  const csrf = form.get("csrf_token");
  const csrfCookie = cookieValue(request, CSRF_COOKIE);
  const sealedConsent = cookieValue(request, CONSENT_STATE_COOKIE);
  if (typeof csrf !== "string" || csrfCookie !== csrf || !sealedConsent) {
    return errorResponse("Invalid or expired authorization request");
  }
  const pending = ConsentStateSchema.safeParse(
    await unsealState(sealedConsent, env.COOKIE_ENCRYPTION_KEY),
  );
  if (!pending.success || pending.data.csrfHash !== await sha256Text(csrf)) {
    return errorResponse("Invalid or expired authorization request");
  }
  const oauthRequest = storedAuthRequest(pending.data.oauthRequest);
  if (form.get("decision") !== "approve") {
    return oauthErrorRedirect(oauthRequest, "access_denied", "The user denied this request");
  }

  const state = randomToken();
  const nonce = randomToken();
  const googleState = await sealState(
    { oauthRequest, state, nonce },
    env.COOKIE_ENCRYPTION_KEY,
    FLOW_TTL_SECONDS,
  );
  const redirectUri = `${new URL(request.url).origin}/oauth/google/callback`;
  return responseWithCookies(
    googleAuthorizationUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri, state, nonce }),
    [
      clearCookie(CSRF_COOKIE),
      clearCookie(CONSENT_STATE_COOKIE),
      setCookie(GOOGLE_STATE_COOKIE, googleState),
    ],
  );
}

async function googleCallback(request: Request, env: CloudflareEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const sealedGoogleState = cookieValue(request, GOOGLE_STATE_COOKIE);
  if (!state || !sealedGoogleState) return errorResponse("Invalid or expired Google authorization");
  const pending = GoogleStateSchema.safeParse(
    await unsealState(sealedGoogleState, env.COOKIE_ENCRYPTION_KEY),
  );
  if (!pending.success || pending.data.state !== state) {
    return errorResponse("Invalid or expired Google authorization");
  }
  if (url.searchParams.has("error")) {
    return oauthErrorRedirect(
      storedAuthRequest(pending.data.oauthRequest),
      "access_denied",
      "Google sign-in was not completed",
    );
  }
  const code = url.searchParams.get("code");
  if (!code) return errorResponse("Google did not return an authorization code");

  let identity;
  try {
    identity = await exchangeGoogleCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/oauth/google/callback`,
      allowedEmail: env.ALLOWED_GOOGLE_EMAIL,
      expectedNonce: pending.data.nonce,
    });
  } catch {
    return errorResponse("Google account is not authorized", 403);
  }

  await env.PROFILE_KV.put(
    "identities/allowed-account",
    JSON.stringify({ subject: identity.subject }),
  );
  const oauthRequest = storedAuthRequest(pending.data.oauthRequest);
  const scope = grantedScopes(oauthRequest.scope);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: identity.subject,
    metadata: { identityProvider: "google" },
    scope,
    props: {
      subject: identity.subject,
      scopes: scope,
      allowedAccountFingerprint: await allowedAccountFingerprint(env.ALLOWED_GOOGLE_EMAIL, env.COOKIE_ENCRYPTION_KEY),
    },
  });
  return responseWithCookies(redirectTo, [clearCookie(GOOGLE_STATE_COOKIE)]);
}

export const oauthApplicationHandler: ExportedHandler<CloudflareEnv> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize" && request.method === "GET") {
      return showConsent(request, env);
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      return submitConsent(request, env);
    }
    if (url.pathname === "/oauth/google/callback" && request.method === "GET") {
      return googleCallback(request, env);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
    }
    return errorResponse("Not found", 404);
  },
};

export const mcpScopes = [...SUPPORTED_SCOPES];

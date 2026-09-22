# MCP server and Cloudflare production adapter

The reusable MCP core remains provider-neutral. The Cloudflare adapter adds a stateless Streamable HTTP endpoint at `/mcp`, Cloudflare KV profile storage, and Google OAuth for one explicitly allowed Google account. The Google account can be a personal Gmail account; it does not need to belong to a Google Workspace organization.

## Tools

- `get_candidate_profile` requires `profile:read` and returns the authenticated subject's current profile, version, and SHA-256 digest.
- `run_dual_assessment` requires `assessment:run`, accepts a questionnaire and tailored resume, loads the current authoritative profile, and sends two comparable requests through the configured `JevClient`.

Neither tool accepts an API key. The server does not persist tailored resumes or Jev results, and its logging interface receives metadata only.

## Local validation

From `server/`:

```bash
npm ci
npm run check
npm run build
```

`npm run check` runs type checking, synthetic tests, and a Cloudflare deployment dry run. The tests connect an official MCP client to the server through the SDK's in-memory transport and verify the KV profile integrity checks. No Cloudflare or Google account is contacted.

## Provider adapter contract

A hosting adapter composes `createJevMcpServer` with:

- a request-scoped `resolveAuthContext` implementation;
- a `ProfileStore` implementation backed by private provider storage;
- a `JevClient`, normally `HttpJevClient`, whose key comes from the provider's secret manager; and
- an optional metadata-only logger.

The adapter is also responsible for the Streamable HTTP transport and OAuth discovery behavior. No provider account identifier, OAuth credential, API key, personal email address, or real candidate profile belongs in this repository.

## Production architecture

- `POST /mcp` is the stable, OAuth-protected Streamable HTTP endpoint.
- Cloudflare's OAuth provider performs MCP OAuth discovery, PKCE/token handling, dynamic client registration, and bearer-token validation.
- Google is the upstream identity provider. Only `openid email profile` are requested. The ID token signature, issuer, audience, verified-email flag, and exact account allowlist are checked.
- The Worker does not retain Google access or refresh tokens. Its MCP token contains only Google's opaque `sub` value and the granted MCP scopes.
- `OAUTH_KV` stores OAuth grants and short-lived login state. `PROFILE_KV` stores the private profile under that opaque subject.
- The profile uploader writes an immutable, SHA-256-addressed record first and advances the `current` pointer second. Reads recompute the digest before returning any profile.

## One-time Cloudflare setup

Run these commands from `server/`. Do not paste secret values into commands that will be committed or into any repository file.

```bash
npm ci
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create PROFILE_KV
```

Copy the two namespace IDs printed by Wrangler into shell variables. They are deployment configuration, not source code:

```bash
export CLOUDFLARE_WORKER_NAME="choose-a-worker-name"
export OAUTH_KV_NAMESPACE_ID="the-oauth-kv-id"
export PROFILE_KV_NAMESPACE_ID="the-profile-kv-id"
npm run deploy
```

The deploy script renders ignored `.wrangler.generated.jsonc` from committed `wrangler.template.jsonc`. Account IDs and namespace IDs therefore stay outside Git.

After the first deployment, add runtime secrets interactively. Wrangler prompts for each value, so the values do not appear in the command or repository:

```bash
npx wrangler secret put JEV_API_KEY -c .wrangler.generated.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID -c .wrangler.generated.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET -c .wrangler.generated.jsonc
npx wrangler secret put ALLOWED_GOOGLE_EMAIL -c .wrangler.generated.jsonc
```

`JEV_API_URL` is optional. Set it as another Worker secret only when overriding the default TypeSafe endpoint.

## One-time Google OAuth setup

Use the Google Cloud console while signed in with the Google account chosen for this project:

1. Create or select a project that is not part of the business Workspace organization.
2. Configure the OAuth consent screen as **External**. If it remains in testing, add the chosen Gmail account as a test user.
3. Request only the standard scopes `openid`, `email`, and `profile`. Do not add Gmail, Drive, or Workspace scopes.
4. Create an **OAuth client ID** of type **Web application**.
5. Add exactly this authorized redirect URI, substituting the deployed Worker origin:

   `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/oauth/google/callback`

6. Store the client ID and secret with the Wrangler commands above. Store the chosen Gmail address as `ALLOWED_GOOGLE_EMAIL`; never add it to a repository file.

This authenticates a Google account but does not connect the Worker to Google Workspace data or require Workspace administrator approval.

## Load the private profile

First connect an OAuth-capable MCP client or the MCP Inspector to:

`https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp`

Complete Google sign-in once. That records only the allowed account's opaque Google subject in `PROFILE_KV`. Then upload a real long-form profile from an ignored location:

```bash
npm run profile:upload -- \
  --profile ../private/path/to/long-form-profile.json \
  --version 2026-09-22 \
  --remote
```

Without `--remote`, the upload goes to Wrangler's local KV, which is the safe default. The uploader never writes the profile into the repository.

## Cloudflare Git deployment

In the Cloudflare Git-connected Worker, set the root directory to `server` and configure:

- Build command: `npm ci && npm run check`
- Deploy command: `npm run deploy`
- Build variables: `CLOUDFLARE_WORKER_NAME`, `OAUTH_KV_NAMESPACE_ID`, and `PROFILE_KV_NAMESPACE_ID`
- Worker runtime secrets: `JEV_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_GOOGLE_EMAIL`

The generated Wrangler file is ignored, so GitHub receives instructions and a variable-driven template—not account IDs, personal identity, candidate data, or secrets.

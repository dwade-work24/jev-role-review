# Provider-neutral MCP server

This package contains the transport- and hosting-neutral core for the Jev Role Review MCP server. It defines two MCP tools, a Jev client boundary, a profile-store boundary, and synthetic local tests. Cloudflare, Google OAuth, and persistent profile storage are intentionally separate adapters for the next milestone.

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

The test suite uses only the explicitly synthetic fixtures under `tests/fixtures/synthetic/`. It connects an official MCP client to the server through the SDK's in-memory transport, discovers both tools, and invokes them end to end with an in-memory profile store and mock Jev client.

## Provider adapter contract

A hosting adapter composes `createJevMcpServer` with:

- a request-scoped `resolveAuthContext` implementation;
- a `ProfileStore` implementation backed by private provider storage;
- a `JevClient`, normally `HttpJevClient`, whose key comes from the provider's secret manager; and
- an optional metadata-only logger.

The adapter is also responsible for the Streamable HTTP transport, OAuth challenge and discovery behavior, rate limits, and deployment-specific configuration. No provider account identifier, OAuth credential, API key, personal email address, or real candidate profile belongs in this repository.

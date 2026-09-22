import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

interface GoogleTokenResponse {
  readonly id_token: string;
}

export interface GoogleIdentity {
  readonly subject: string;
}

export function validateGoogleClaims(
  claims: JWTPayload,
  allowedEmail: string,
): GoogleIdentity {
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (
    typeof claims.sub !== "string"
    || !claims.sub.trim()
    || claims.email_verified !== true
    || email !== allowedEmail.trim().toLowerCase()
  ) {
    throw new Error("Google account is not authorized");
  }
  return { subject: claims.sub };
}

export function googleAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", options.state);
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmail: string;
  expectedNonce: string;
  fetchImplementation?: typeof fetch;
}): Promise<GoogleIdentity> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google authorization failed");
  const token = await response.json() as Partial<GoogleTokenResponse>;
  if (typeof token.id_token !== "string") throw new Error("Google did not return an ID token");
  const verified = await jwtVerify(token.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: options.clientId,
    algorithms: ["RS256"],
  });
  if (verified.payload.nonce !== options.expectedNonce) {
    throw new Error("Google ID token nonce did not match");
  }
  return validateGoogleClaims(verified.payload, options.allowedEmail);
}

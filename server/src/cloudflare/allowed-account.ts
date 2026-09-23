import type { McpAuthProps } from "./env.js";

export async function allowedAccountFingerprint(email: string, signingKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isCurrentAllowlistedGrant(props: McpAuthProps, allowedEmail: string, signingKey: string): Promise<boolean> {
  return props.allowedAccountFingerprint === await allowedAccountFingerprint(allowedEmail, signingKey);
}

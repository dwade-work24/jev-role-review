import assert from "node:assert/strict";
import test from "node:test";
import type { JWTPayload } from "jose";
import { googleAuthorizationUrl, validateGoogleClaims } from "../src/cloudflare/google.js";
import { allowedAccountFingerprint, isCurrentAllowlistedGrant } from "../src/cloudflare/allowed-account.js";
import { sealState, unsealState } from "../src/cloudflare/signed-state.js";
import { sha256Json } from "../src/domain/json.js";
import {
  CloudflareKvProfileStore,
  ProfileStoreIntegrityError,
  currentProfileKey,
  profileKey,
} from "../src/profile/store.js";

class FakeKv {
  readonly values = new Map<string, unknown>();

  async get(key: string, _options: { type: "json" }): Promise<unknown> {
    return this.values.get(key) ?? null;
  }
}

test("KV profile store follows the private current pointer and verifies the digest", async () => {
  const kv = new FakeKv();
  const subject = "synthetic-google-subject";
  const profile = { name: "Synthetic Candidate", roles: [{ company: "Example Company" }] };
  const sha256 = await sha256Json(profile);
  kv.values.set(currentProfileKey(subject), { version: "synthetic-v1", sha256 });
  kv.values.set(profileKey(subject, sha256), { version: "synthetic-v1", sha256, profile });

  const loaded = await new CloudflareKvProfileStore(kv).getCurrent(subject);
  assert.deepEqual(loaded, { version: "synthetic-v1", sha256, profile });
});

test("KV profile store rejects content that does not match its digest", async () => {
  const kv = new FakeKv();
  const subject = "synthetic-google-subject";
  const sha256 = await sha256Json({ name: "Expected" });
  kv.values.set(currentProfileKey(subject), { version: "synthetic-v1", sha256 });
  kv.values.set(profileKey(subject, sha256), {
    version: "synthetic-v1",
    sha256,
    profile: { name: "Changed" },
  });

  await assert.rejects(
    new CloudflareKvProfileStore(kv).getCurrent(subject),
    ProfileStoreIntegrityError,
  );
});

test("Google claims require a verified exact allowlisted account and return only sub", () => {
  const at = String.fromCharCode(64);
  const allowedEmail = `allowed${at}example.test`;
  const claims: JWTPayload = {
    sub: "synthetic-google-subject",
    email: allowedEmail,
    email_verified: true,
  };
  assert.deepEqual(validateGoogleClaims(claims, allowedEmail.toUpperCase()), {
    subject: "synthetic-google-subject",
  });
  assert.throws(
    () => validateGoogleClaims({ ...claims, email: `other${at}example.test` }, allowedEmail),
    /not authorized/,
  );
  assert.throws(
    () => validateGoogleClaims({ ...claims, email_verified: false }, allowedEmail),
    /not authorized/,
  );
});

test("Google authorization requests only identity scopes and binds an OIDC nonce", () => {
  const url = new URL(googleAuthorizationUrl({
    clientId: "synthetic-client",
    redirectUri: "https://mcp.example.test/oauth/google/callback",
    state: "synthetic-state",
    nonce: "synthetic-nonce",
  }));
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "synthetic-state");
  assert.equal(url.searchParams.get("nonce"), "synthetic-nonce");
  assert.equal(url.searchParams.has("access_type"), false);
});

test("existing grants stop working when the allowed Google account changes", async () => {
  const signingKey = "test-".repeat(12);
  const props = {
    subject: "synthetic-subject",
    scopes: ["profile:read"],
    allowedAccountFingerprint: await allowedAccountFingerprint("allowed@example.com", signingKey),
  };
  assert.equal(await isCurrentAllowlistedGrant(props, "ALLOWED@EXAMPLE.COM", signingKey), true);
  assert.equal(await isCurrentAllowlistedGrant(props, "other@example.com", signingKey), false);
  assert.equal(await isCurrentAllowlistedGrant({ ...props, allowedAccountFingerprint: "" }, "allowed@example.com", signingKey), false);
});

test("OAuth browser state is signed, tamper-evident, and expires", async () => {
  const key = "synthetic-cookie-signing-key-32-characters-minimum";
  const sealed = await sealState({ request: "synthetic" }, key, 60);
  assert.deepEqual(await unsealState(sealed, key), { request: "synthetic" });

  const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("a") ? "b" : "a"}`;
  assert.equal(await unsealState(tampered, key), null);

  // Flip an unused low bit of the final signature character: atob may still
  // decode it to the same bytes, but the signed representation must be unique.
  const alphabet = ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", "01234", "56789-_"].join("");
  const last = sealed.at(-1)!;
  const equivalent = `${sealed.slice(0, -1)}${alphabet[alphabet.indexOf(last) ^ 1]}`;
  assert.equal(await unsealState(equivalent, key), null);

  const expired = await sealState({ request: "synthetic" }, key, -1);
  assert.equal(await unsealState(expired, key), null);
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmac(keyMaterial: string, value: string): Promise<Uint8Array> {
  if (keyMaterial.length < 32) throw new Error("Cookie signing key must be at least 32 characters");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

interface SignedEnvelope {
  readonly expiresAt: number;
  readonly value: unknown;
}

export async function sealState(
  value: unknown,
  keyMaterial: string,
  ttlSeconds: number,
): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    expiresAt: Date.now() + ttlSeconds * 1_000,
    value,
  } satisfies SignedEnvelope)));
  const signature = base64UrlEncode(await hmac(keyMaterial, payload));
  const sealed = `${payload}.${signature}`;
  if (sealed.length > 3_800) throw new Error("Authorization state is too large for a cookie");
  return sealed;
}

export async function unsealState(
  sealed: string,
  keyMaterial: string,
): Promise<unknown | null> {
  const [payload, suppliedSignature, extra] = sealed.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  let expectedSignature: Uint8Array;
  let decodedSignature: Uint8Array;
  try {
    expectedSignature = await hmac(keyMaterial, payload);
    decodedSignature = base64UrlDecode(suppliedSignature);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expectedSignature, decodedSignature)) return null;
  try {
    const envelope = JSON.parse(decoder.decode(base64UrlDecode(payload))) as Partial<SignedEnvelope>;
    if (
      typeof envelope.expiresAt !== "number"
      || envelope.expiresAt <= Date.now()
      || !("value" in envelope)
    ) return null;
    return envelope.value;
  } catch {
    return null;
  }
}

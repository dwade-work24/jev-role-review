import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { sha256Json } from "../src/domain/json.js";
import { JsonObjectSchema } from "../src/domain/schemas.js";
import { currentProfileKey, profileKey } from "../src/profile/store.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Required argument: ${name}`);
  return value;
}

function wrangler(args: string[]): string {
  const result = spawnSync("npx", ["--no-install", "wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Wrangler failed with exit code ${result.status ?? "unknown"}`);
  return result.stdout.trim();
}

const IdentitySchema = z.object({ subject: z.string().min(1) }).strict();
const profilePath = argument("--profile");
const version = argument("--version");
const remoteFlag = process.argv.includes("--remote") ? "--remote" : "--local";
const config = process.argv.includes("--config")
  ? argument("--config")
  : ".wrangler.generated.jsonc";

const profile = JsonObjectSchema.parse(JSON.parse(await readFile(profilePath, "utf8")));
const identityRaw = wrangler([
  "kv", "key", "get", "identities/allowed-account",
  "--binding", "PROFILE_KV", remoteFlag, "--text", "--config", config,
]);
const { subject } = IdentitySchema.parse(JSON.parse(identityRaw));
const sha256 = await sha256Json(profile);
const record = { version, sha256, profile };
const pointer = { version, sha256 };
const temporaryDirectory = await mkdtemp(join(tmpdir(), "jev-profile-"));

try {
  const recordPath = join(temporaryDirectory, "record.json");
  const pointerPath = join(temporaryDirectory, "pointer.json");
  await writeFile(recordPath, JSON.stringify(record));
  await writeFile(pointerPath, JSON.stringify(pointer));
  wrangler([
    "kv", "key", "put", profileKey(subject, sha256),
    "--binding", "PROFILE_KV", remoteFlag, "--path", recordPath, "--config", config,
  ]);
  wrangler([
    "kv", "key", "put", currentProfileKey(subject),
    "--binding", "PROFILE_KV", remoteFlag, "--path", pointerPath, "--config", config,
  ]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Uploaded profile version ${version} with SHA-256 ${sha256}.`);

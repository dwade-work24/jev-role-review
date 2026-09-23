import { readFile, writeFile } from "node:fs/promises";

const dryRun = process.argv.includes("--dry-run");
const placeholders = dryRun
  ? {
      CLOUDFLARE_WORKER_NAME: "jev-role-review-dry-run",
      OAUTH_KV_NAMESPACE_ID: "00000000000000000000000000000000",
      PROFILE_KV_NAMESPACE_ID: "11111111111111111111111111111111",
      ASSESSMENT_RATE_LIMIT_NAMESPACE_ID: "1001",
    }
  : {};
const values = {
  CLOUDFLARE_WORKER_NAME: process.env.CLOUDFLARE_WORKER_NAME ?? placeholders.CLOUDFLARE_WORKER_NAME,
  OAUTH_KV_NAMESPACE_ID: process.env.OAUTH_KV_NAMESPACE_ID ?? placeholders.OAUTH_KV_NAMESPACE_ID,
  PROFILE_KV_NAMESPACE_ID: process.env.PROFILE_KV_NAMESPACE_ID ?? placeholders.PROFILE_KV_NAMESPACE_ID,
  ASSESSMENT_RATE_LIMIT_NAMESPACE_ID: process.env.ASSESSMENT_RATE_LIMIT_NAMESPACE_ID ?? placeholders.ASSESSMENT_RATE_LIMIT_NAMESPACE_ID ?? "1001",
};

for (const [name, value] of Object.entries(values)) {
  if (!value) throw new Error(`Missing required deployment variable: ${name}`);
}
if (!/^[1-9]\d*$/.test(values.ASSESSMENT_RATE_LIMIT_NAMESPACE_ID)) {
  throw new Error("ASSESSMENT_RATE_LIMIT_NAMESPACE_ID must be a positive integer");
}

let config = await readFile(new URL("../wrangler.template.jsonc", import.meta.url), "utf8");
for (const [name, value] of Object.entries(values)) {
  config = config.replaceAll(`\${${name}}`, value);
}
await writeFile(new URL("../.wrangler.generated.jsonc", import.meta.url), config, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(`Generated Cloudflare configuration${dryRun ? " for local validation" : ""}.`);

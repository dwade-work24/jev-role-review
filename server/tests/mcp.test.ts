import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { JevAssessmentRequest, JevClient } from "../src/jev/client.js";
import { createJevMcpServer, type MetadataLogger } from "../src/mcp.js";
import { InMemoryProfileStore } from "../src/profile/store.js";

async function fixture(name: string): Promise<Record<string, unknown>> {
  const url = new URL(`../../tests/fixtures/synthetic/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as Record<string, unknown>;
}

test("MCP discovery and both tools work end to end with synthetic data", async (context) => {
  const profileStore = new InMemoryProfileStore();
  await profileStore.put("synthetic-user", "synthetic-v1", await fixture("long_form_history.json"));

  const requests: JevAssessmentRequest[] = [];
  const jevClient: JevClient = {
    async assess(request) {
      requests.push(structuredClone(request));
      return { answers: { result: "synthetic-pass" }, model: request.model };
    },
  };
  const logEntries: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
  const logger: MetadataLogger = {
    info: (event, fields) => logEntries.push({ event, fields }),
    error: (event, fields) => logEntries.push({ event, fields }),
  };
  const server = createJevMcpServer({
    profileStore,
    jevClient,
    logger,
    resolveAuthContext: () => ({
      subject: "synthetic-user",
      scopes: new Set(["profile:read", "assessment:run"]),
    }),
  });
  const client = new Client({ name: "synthetic-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ["get_candidate_profile", "run_dual_assessment"],
  );

  const profileResult = await client.callTool({
    name: "get_candidate_profile",
    arguments: {},
  });
  assert.equal(profileResult.isError, undefined);
  assert.equal((profileResult.structuredContent as { version: string }).version, "synthetic-v1");

  const assessmentResult = await client.callTool({
    name: "run_dual_assessment",
    arguments: {
      questionnaire: await fixture("questionnaire.json"),
      tailored_resume: await fixture("recommended_resume.json"),
      model: "jev-synthetic",
    },
  });
  assert.equal(assessmentResult.isError, undefined);
  assert.equal(requests.length, 2);
  assert.equal(
    (assessmentResult.structuredContent as { profile: { version: string } }).profile.version,
    "synthetic-v1",
  );

  const serializedLogs = JSON.stringify(logEntries);
  assert.doesNotMatch(serializedLogs, /Sample Candidate|Example Manufacturing Company/);
});

test("dual assessment logs only sanitized Jev failure metadata", async (context) => {
  const profileStore = new InMemoryProfileStore();
  await profileStore.put("synthetic-user", "synthetic-v1", await fixture("long_form_history.json"));
  const logEntries: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
  const server = createJevMcpServer({
    profileStore,
    jevClient: {
      async assess() {
        const { JevUpstreamError } = await import("../src/jev/client.js");
        throw new JevUpstreamError("http", "private upstream response", 401);
      },
    },
    logger: {
      info: (event, fields) => logEntries.push({ event, fields }),
      error: (event, fields) => logEntries.push({ event, fields }),
    },
    resolveAuthContext: () => ({
      subject: "synthetic-user",
      scopes: new Set(["assessment:run"]),
    }),
  });
  const client = new Client({ name: "synthetic-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "run_dual_assessment",
    arguments: {
      questionnaire: await fixture("questionnaire.json"),
      tailored_resume: await fixture("recommended_resume.json"),
      model: "jev-synthetic",
    },
  });

  assert.equal(result.isError, true);
  const failureLog = logEntries.find((entry) => entry.event === "dual_assessment_failed");
  assert.ok(failureLog);
  assert.deepEqual(failureLog.fields.failures, [
    { view: "tailored_resume", kind: "http", status: 401 },
    { view: "long_form_history", kind: "http", status: 401 },
  ]);
  assert.doesNotMatch(JSON.stringify(logEntries), /private upstream response|Sample Candidate/);
});

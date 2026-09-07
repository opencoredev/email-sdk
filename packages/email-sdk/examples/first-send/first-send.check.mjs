import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { run } from "./first-send.mjs";

process.env.EMAIL_SDK_TELEMETRY = "0";

const throwingFetch = () => {
  throw new Error("unexpected network request");
};
const noNetwork = { baseUrl: "http://127.0.0.1:9", fetch: throwingFetch };

test("default command validates without credentials and never calls transport", async () => {
  const result = await run({ env: {}, fixture: noNetwork });
  assert.deepEqual(result, { ok: true, mode: "validate", adapter: "resend", sent: false });
});

test("--send refuses without EMAIL_FROM and EMAIL_TO, before any network call", async () => {
  await assert.rejects(run({ args: ["--send"], env: {}, fixture: noNetwork }), /EMAIL_FROM and EMAIL_TO/);
  await assert.rejects(
    run({ args: ["--send"], env: { EMAIL_FROM: "hello@acme-starter.dev" }, fixture: noNetwork }),
    /EMAIL_FROM and EMAIL_TO/,
  );
  await assert.rejects(
    run({ args: ["--send"], env: { EMAIL_TO: "test@acme-starter.dev" }, fixture: noNetwork }),
    /EMAIL_FROM and EMAIL_TO/,
  );
});

test("--send refuses placeholder keys and example addresses", async () => {
  const addresses = { EMAIL_FROM: "hello@acme-starter.dev", EMAIL_TO: "test@acme-starter.dev" };
  await assert.rejects(run({ args: ["--send"], env: addresses }), /RESEND_API_KEY/);
  await assert.rejects(
    run({ args: ["--send"], env: { ...addresses, RESEND_API_KEY: "re_replace_with_real_server_key" } }),
    /RESEND_API_KEY/,
  );
  await assert.rejects(
    run({
      args: ["--send"],
      env: { EMAIL_FROM: "hello@example.com", EMAIL_TO: "approved@acme-starter.dev", RESEND_API_KEY: "re_not_a_real_secret_1234" },
    }),
    /Replace example addresses/,
  );
  await assert.rejects(
    run({
      args: ["--send"],
      env: { EMAIL_FROM: "sender@example.test", EMAIL_TO: "recipient@example.test", RESEND_API_KEY: "re_test_synthetic_000" },
      fixture: undefined,
    }),
    /Replace example addresses/,
  );
});

test("usage and malformed addresses are rejected", async () => {
  await assert.rejects(run({ args: ["--base-url"], env: {} }), /Usage/);
  await assert.rejects(run({ env: { EMAIL_FROM: "invalid" }, fixture: noNetwork }), /valid mailbox/);
});

test("CLI refusal exits 1 without leaking credentials", () => {
  const result = spawnSync(process.execPath, ["first-send.mjs", "--send"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, EMAIL_SDK_TELEMETRY: "0", RESEND_API_KEY: "re_private_do_not_log", EMAIL_FROM: "", EMAIL_TO: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EMAIL_FROM and EMAIL_TO/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("re_private_do_not_log"));
});

test("fixture scope rejects remote origins and real credentials", async () => {
  for (const baseUrl of ["https://api.resend.com", "http://localhost:1234", "http://127.0.0.1:1234/path", "http://user:pass@127.0.0.1:1234"]) {
    await assert.rejects(run({ env: {}, fixture: { baseUrl } }), /Fixtures require/);
  }
  await assert.rejects(
    run({ env: { RESEND_API_KEY: "re_do_not_forward" }, fixture: { baseUrl: "http://127.0.0.1:1234" } }),
    /reject real credentials/,
  );
});

test("explicit send posts once to the loopback fixture and returns its receipt", async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    assert.equal(request.url, "/emails");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer re_fixture_only");
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).subject, "Your first Email SDK message");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "fixture-id" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const fixture = { baseUrl: `http://127.0.0.1:${server.address().port}` };
    const env = { EMAIL_FROM: "hello@example.com", EMAIL_TO: "test@example.com" };
    const result = await run({ args: ["--send"], env, fixture });
    assert.equal(result.mode, "send");
    assert.equal(result.adapter, "resend");
    assert.equal(result.id, "fixture-id");
    assert.match(result.receipt, /not confirmed/);
    assert.equal(requests, 1);

    const rejected = { ...fixture, fetch: async () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403, headers: { "Content-Type": "application/json" } }) };
    await assert.rejects(
      run({ args: ["--send"], env, fixture: rejected }),
      (error) => error.code === "route_error" && error.cause.code === "adapter_error" && error.cause.status === 403,
    );
  } finally {
    await new Promise((done) => server.close(done));
  }
});

import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";
import { resend } from "@opencoredev/email-sdk/resend";
import {
  database,
  setup,
  transaction,
  enqueue,
  runOne,
  recover,
  reconcile,
  type Route,
} from "./durable.js";
import { webhook } from "./webhook.js";

function route(): Route {
  const mode = process.env.EMAIL_MODE ?? "memory";
  const account = process.env.EMAIL_ACCOUNT ?? "local-fixture";
  if (mode === "memory") {
    const adapter = memoryAdapter();
    const send = adapter.send;
    adapter.send = async (message, context) => ({
      ...(await send(message, context)),
      id: `fixture_${randomUUID()}`,
    });
    return {
      provider: "memory",
      account,
      email: createEmailClient({
        adapters: [adapter],
        telemetry: false,
        retry: { maxAttempts: 1 },
      }),
    };
  }
  if (
    mode !== "resend" ||
    process.env.EMAIL_LIVE_SEND !== "I_AUTHORIZE_REAL_EMAIL" ||
    !process.env.RESEND_API_KEY ||
    account === "local-fixture"
  )
    throw new Error("Live sending requires explicit mode, authorization, key, and account");
  return {
    provider: "resend",
    account,
    email: createEmailClient({
      adapters: [resend({ apiKey: process.env.RESEND_API_KEY })],
      telemetry: false,
      retry: { maxAttempts: 1 },
    }),
  };
}
const pool = database(
  process.env.DATABASE_URL ?? "postgres://email_sdk_test@127.0.0.1:5438/email_sdk_adoption",
  process.env.DATABASE_SCHEMA,
);
const [command, ...args] = process.argv.slice(2);
let serverRunning = false;
try {
  switch (command) {
    case "setup":
      await setup(pool, process.env.DATABASE_SCHEMA);
      console.log(JSON.stringify({ event: "schema_ready" }));
      break;
    case "enqueue": {
      const id = await transaction(pool, async (tx) => {
        const key = args[0] ?? "welcome:fixture-user:v1";
        await tx.query(
          "INSERT INTO business_records(id,state) VALUES($1,'active') ON CONFLICT(id) DO UPDATE SET state='active'",
          [key],
        );
        return enqueue(tx, route(), {
          key,
          message: {
            from: "sender@example.test",
            to: [args[1] ?? "recipient@example.test"],
            subject: "Durable welcome fixture",
            text: "This is a safe local fixture.",
          },
        });
      });
      console.log(JSON.stringify({ event: "enqueued", jobId: id }));
      break;
    }
    case "worker": {
      const emailRoute = route();
      let processed = 0;
      while (await runOne(pool, emailRoute)) processed++;
      console.log(JSON.stringify({ event: "worker_drained", processed }));
      break;
    }
    case "status": {
      const rows = await pool.query(
        "SELECT id,state,attempts,max_attempts,next_at,delivery FROM jobs ORDER BY created_at DESC LIMIT 100",
      );
      console.log(JSON.stringify(rows.rows, null, 2));
      break;
    }
    case "reconcile": {
      await recover(pool);
      const [id, decision, evidence, messageId] = args;
      if (!id) {
        console.log(
          JSON.stringify(
            (
              await pool.query(
                "SELECT id,attempts,updated_at FROM jobs WHERE state='needs_reconciliation' ORDER BY updated_at",
              )
            ).rows,
          ),
        );
      } else {
        if (decision !== "accepted" && decision !== "not_sent" && decision !== "abandon")
          throw new Error("Decision must be accepted, not_sent, or abandon");
        await reconcile(pool, id, decision, evidence ?? "", messageId);
        console.log(JSON.stringify({ event: "reconciled", jobId: id, decision }));
      }
      break;
    }
    case "webhook": {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      const account = process.env.WEBHOOK_ACCOUNT;
      if (!secret || !account) throw new Error("Webhook secret and fixed account are required");
      const server = createServer(async (request, response) => {
        try {
          if (request.method !== "POST" || request.url !== "/webhooks/resend") {
            response.writeHead(404).end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 262144) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers))
            if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
          const result = await webhook(
            pool,
            account,
            secret,
            new Request("http://localhost/webhooks/resend", {
              method: "POST",
              headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          response.writeHead(result.status).end(await result.text());
        } catch {
          response.writeHead(503).end("Unavailable");
        }
      });
      server.listen(Number(process.env.WEBHOOK_PORT ?? 8787), "127.0.0.1");
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          server.close(() => {
            void pool.end();
          });
        });
      serverRunning = true;
      console.log(JSON.stringify({ event: "webhook_listening" }));
      break;
    }
    default:
      throw new Error("Choose setup, enqueue, worker, status, reconcile, or webhook");
  }
} catch {
  console.error(JSON.stringify({ event: "command_failed", command }));
  process.exitCode = 1;
} finally {
  if (!serverRunning) await pool.end();
}

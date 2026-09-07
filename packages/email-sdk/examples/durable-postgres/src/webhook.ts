import type { Pool } from "pg";
import { normalizeWebhookEvent, verifyResendWebhook } from "@opencoredev/email-sdk/webhooks";
import { ingest } from "./durable.js";

export async function webhook(
  pool: Pool,
  account: string,
  secret: string | readonly string[],
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 262144)
    return new Response("Too large", { status: 413 });
  if (!account || !(await verifyResendWebhook({ body, headers: request.headers, secret })))
    return new Response("Unauthorized", { status: 401 });
  try {
    const event = await normalizeWebhookEvent({
      provider: "resend",
      body,
      headers: request.headers,
    });
    await ingest(pool, account, event);
    return new Response("OK", { status: 200 });
  } catch {
    // A non-2xx response requests provider retry if persistence failed.
    return new Response("Unavailable", { status: 503 });
  }
}

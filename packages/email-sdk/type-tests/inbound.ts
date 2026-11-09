import { handleInbound, parseInbound } from "../src/inbound.js";
import type { InboundEmail, InboundHandlerResult } from "../src/inbound.js";

const payload = { body: "[]" };

// Brevo needs an API key for attachment.read(), so parseInbound accepts its options inline.
const brevo: Promise<InboundEmail[]> = parseInbound("brevo", payload, { apiKey: "xkeysib-test", baseUrl: "https://api.brevo.com/v3" });

// Self-hosted Primitive download origins are accepted by both entry points.
const primitive: Promise<InboundEmail[]> = parseInbound("primitive", payload, { downloadOrigins: ["http://localhost:4001"] });

const handled: Promise<InboundHandlerResult> = handleInbound(new Request("https://example.test/inbound"), {
  provider: "primitive",
  secret: "whsec_test",
  downloadOrigins: ["https://mail.example.com"],
});

// @ts-expect-error parseInbound options are typed, so a misspelled key is caught
void parseInbound("brevo", payload, { apiKy: "xkeysib-test" });

void brevo;

void primitive;

void handled;

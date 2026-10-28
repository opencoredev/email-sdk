import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";

const adapterNames = ["postmark", "sendgrid"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "sendgrid"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    postmark({ serverToken: requireEnv("POSTMARK_SERVER_TOKEN") }),
    sendgrid({ apiKey: requireEnv("SENDGRID_API_KEY") }),
  ],
  defaultAdapter: parsePrimary(process.env.EMAIL_PRIMARY),
  fallback: {
    adapters: adapterNames,
    onUnknownDelivery: "continue",
  },
});

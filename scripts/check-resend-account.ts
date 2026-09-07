import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

config({ path: ".env.local" });
config();

const targetDomain = process.env.RESEND_TEST_DOMAIN;
const result = await runDoctor({
  adapter: "resend",
  credential: process.env.RESEND_API_KEY,
  live: true,
  baseUrl: process.env.RESEND_BASE_URL,
  from: targetDomain ? `probe@${targetDomain}` : undefined,
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

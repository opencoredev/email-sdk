import { cronJobs, type FunctionReference } from "convex/server";

import { internal } from "./_generated/api.js";

type ProcessDueEmailsRef = FunctionReference<
  "mutation",
  "internal",
  { limit?: number },
  number
>;
const internalApi = internal as unknown as { lib: { processDueEmails: ProcessDueEmailsRef } };
const crons = cronJobs();

crons.interval("Sweep email queue and cleanup", { minutes: 5 }, internalApi.lib.processDueEmails, {
  limit: 25,
});

export default crons;

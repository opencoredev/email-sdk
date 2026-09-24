import { cronJobs } from "convex/server";

import { internalFunctions } from "./functionRefs.js";

const crons = cronJobs();

crons.interval(
  "Sweep email queue and cleanup",
  { minutes: 5 },
  internalFunctions.lib.processDueEmails,
  { limit: 25 },
);

export default crons;

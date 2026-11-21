import { defineComponent } from "convex/server";

/**
 * The component runs entirely in Convex's default runtime: Convex rejects `"use node"` modules
 * inside components. Provider requests run in the app's own Node action (`emailSender` from
 * `@opencoredev/convex-email/node`), which reads adapter credentials from the deployment
 * environment, so the component declares no environment variables.
 */
export default defineComponent("convexEmail");

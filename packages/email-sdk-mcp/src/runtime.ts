import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { EmailMcpService, type EmailMcpApprovalResult } from "./service.js";
import { isSingleMailbox } from "./policy.js";
import type { ValidationRecord } from "./store.js";
import type { EmailMcpServerOptions } from "./types.js";

const addressSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine(isSingleMailbox, "Each recipient entry must contain exactly one email mailbox.");
const addressListSchema = z.union([
  addressSchema,
  z.array(addressSchema).min(1).max(100),
]);

const validateInputSchema = z
  .object({
    to: addressListSchema,
    cc: addressListSchema.optional(),
    bcc: addressListSchema.optional(),
    replyTo: addressListSchema.optional(),
    subject: z.string().min(1).max(998),
    text: z.string().max(1_000_000).optional(),
    html: z.string().max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => value.text !== undefined || value.html !== undefined, {
    message: "Provide text, html, or both.",
  });

const failureFields = {
  code: z
    .enum([
      "configuration_error",
      "validation_error",
      "policy_denied",
      "reference_not_found",
      "reference_expired",
      "reference_used",
      "reference_mismatch",
      "approval_unavailable",
      "approval_declined",
      "approval_cancelled",
      "approval_timeout",
      "send_disabled",
      "adapter_error",
      "route_error",
      "aborted",
      "internal_error",
    ])
    .optional(),
  status: z.enum(["sent", "failed", "outcome_unknown"]).optional(),
  adapter: z.string().max(100).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  retryable: z.boolean().optional(),
  delivery: z.enum(["not_sent", "unknown"]).optional(),
} as const;

const statusOutputSchema = z
  .object({
    ok: z.boolean(),
    configured: z.boolean().optional(),
    sendEnabled: z.boolean().optional(),
    missingEnvironment: z.array(z.string().max(100)).optional(),
    policy: z
      .object({
        maxRecipients: z.number().int().positive(),
        maxSubjectLength: z.number().int().positive(),
        maxTextLength: z.number().int().positive(),
        maxHtmlLength: z.number().int().positive(),
        validationTtlMs: z.number().int().positive(),
        maxPendingValidations: z.number().int().positive(),
        approvalTimeoutMs: z.number().int().positive(),
        recipientAllowlistConfigured: z.boolean(),
        domainAllowlistConfigured: z.boolean(),
      })
      .strict()
      .optional(),
    ...failureFields,
  })
  .strict();

const validateOutputSchema = z
  .object({
    ok: z.boolean(),
    validationReference: z.string().max(160).optional(),
    expiresAt: z.string().datetime().optional(),
    summary: z
      .object({
        adapter: z.string().max(100),
        recipientCount: z.number().int().nonnegative(),
        ccCount: z.number().int().nonnegative(),
        bccCount: z.number().int().nonnegative(),
        hasText: z.boolean(),
        hasHtml: z.boolean(),
        attachmentCount: z.literal(0),
      })
      .strict()
      .optional(),
    warningCount: z.number().int().nonnegative().optional(),
    ...failureFields,
  })
  .strict();

const sendOutputSchema = z
  .object({
    ok: z.boolean(),
    receiptId: z.string().max(64).optional(),
    acceptedCount: z.number().int().nonnegative().optional(),
    rejectedCount: z.number().int().nonnegative().optional(),
    ...failureFields,
  })
  .strict();

export function createEmailMcpServer(options: EmailMcpServerOptions): McpServer {
  const service = new EmailMcpService(options);
  const server = new McpServer({
    name: "@opencoredev/email-sdk-mcp",
    version: packageVersion(),
  });

  server.registerTool(
    "email_configuration_status",
    {
      title: "Email configuration status",
      description:
        "Return safe configuration booleans, missing environment variable names, and policy limits without testing credentials.",
      inputSchema: z.object({}).strict(),
      outputSchema: statusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => toolResult(service.configurationStatus(), "Email MCP configuration status returned."),
  );

  server.registerTool(
    "email_validate",
    {
      title: "Validate email",
      description:
        "Validate one email without network access and return a short-lived opaque reference. The reference is not approval.",
      inputSchema: validateInputSchema,
      outputSchema: validateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      toolResult(
        await service.validate(input),
        "Email validated. Use the opaque reference to request approval.",
      ),
  );

  if (service.sendEnabled) {
    server.registerTool(
      "email_send",
      {
        title: "Send validated email",
        description:
          "Request user approval for one stored email and send it once. This tool accepts only an opaque validation reference.",
        inputSchema: z
          .object({
            validationReference: z.string().regex(/^emv_[A-Za-z0-9_-]{16,128}$/),
          })
          .strict(),
        outputSchema: sendOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ validationReference }, extra) =>
        toolResult(
          await service.send(
            validationReference,
            (record, signal) => elicitApproval(server, service, record, signal),
            extra.signal,
          ),
          "Email send request completed.",
        ),
    );
  }

  return server;
}

async function elicitApproval(
  server: McpServer,
  service: EmailMcpService,
  record: Readonly<ValidationRecord>,
  signal: AbortSignal,
): Promise<EmailMcpApprovalResult> {
  if (!server.server.getClientCapabilities()?.elicitation?.form) {
    return "unavailable";
  }

  try {
    const result = await server.server.elicitInput(
      {
        mode: "form",
        message: service.approvalMessage(record),
        requestedSchema: {
          type: "object",
          properties: {
            approve: {
              type: "boolean",
              title: "Send this email now",
              description: "This sends the exact email shown above and cannot be undone.",
              default: false,
            },
          },
          required: ["approve"],
        },
      },
      {
        signal,
        timeout: service.approvalTimeoutMs,
        maxTotalTimeout: service.approvalTimeoutMs,
      },
    );

    if (result.action === "decline") {
      return "decline";
    }

    if (result.action === "cancel") {
      return "cancel";
    }

    return result.content?.approve === true ? "accept" : "decline";
  } catch (error) {
    return error instanceof McpError && error.code === ErrorCode.RequestTimeout
      ? "timeout"
      : "unavailable";
  }
}

function toolResult(result: object & { ok: boolean }, successText: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: result.ok ? successText : "Email MCP request failed.",
      },
    ],
    structuredContent: result as Record<string, unknown>,
    ...(!result.ok ? { isError: true } : {}),
  };
}

function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

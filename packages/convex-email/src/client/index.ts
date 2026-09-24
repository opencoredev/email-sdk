import { verifyMailgunWebhook, verifyResendWebhook } from "@opencoredev/email-sdk/webhooks";
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { httpActionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import type { ConvexEmailComponentApi } from "../shared/componentApi.js";
import type {
  ConvexEmailAdapterConfig,
  ConvexEmailConfig,
  ConvexEmailDeliveryStatus,
  ConvexEmailDoc,
  ConvexEmailEventDoc,
  ConvexEmailMessage,
  ConvexEmailProviderFailure,
  ConvexEmailSendArgs,
} from "../shared/types.js";
import {
  vCancelEmailArgs,
  vEmailConfig,
  vEmailEventRecord,
  vEmailRecord,
  vListEmailEventsArgs,
  vRetryEmailArgs,
  vSendBatchEmailsArgs,
  vSendEmailArgs,
  vStatusArgs,
} from "../shared/validators.js";

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;

type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;

type ActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runAction">;

type PublicMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "runQuery" | "auth">;

type PublicQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery" | "auth">;

type PublicContext = PublicMutationCtx | PublicQueryCtx;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS" | "PATCH";

type HttpRouterLike = {
  route(route: {
    path: string;
    method: HttpMethod;
    handler: ReturnType<typeof httpActionGeneric>;
  }): void;
};

/** What a webhook verifier sees for one incoming provider request. */
export type ConvexEmailWebhookRequest = {
  /** The provider segment of the route, for example `resend` in `/email/webhooks/resend`. */
  provider: string;
  request: Request;
  /** The raw request body. Signatures are computed over these exact bytes. */
  body: string;
  /** Request headers with lowercase names. */
  headers: Record<string, string>;
};

/** Returns true only when the request is authentic for its provider. */
export type ConvexEmailWebhookVerifier = (
  input: ConvexEmailWebhookRequest,
) => boolean | Promise<boolean>;

export type ConvexEmailRegisterRoutesOptions = {
  /** Route prefix. Defaults to `/email`, which serves `/email/webhooks/<provider>`. */
  pathPrefix?: string;
  /** Providers to register routes for. Defaults to `["resend"]`. */
  providers?: string[];
  /**
   * Authenticates each webhook before the component records it. Required unless
   * `unsafeAllowUnverifiedWebhooks` is set. Build one with `verifyByProvider()` and the provider
   * helpers exported from this package.
   */
  verify?: ConvexEmailWebhookVerifier;
  /**
   * Accepts webhooks without verification. Anyone who can reach the route can then mark emails
   * delivered, bounced, or complained. Use it only for local development.
   */
  unsafeAllowUnverifiedWebhooks?: boolean;
};

export type ConvexEmailSecretOption = string | readonly string[];

export type ResendWebhookVerifierOptions = {
  /** The Resend (Svix) signing secret, `whsec_...`. Pass several during rotation. */
  secret: ConvexEmailSecretOption;
  toleranceSeconds?: number;
};

export type MailgunWebhookVerifierOptions = {
  /** The Mailgun HTTP webhook signing key. Pass several during rotation. */
  secret: ConvexEmailSecretOption;
  toleranceSeconds?: number;
  signatureField?: "signature" | "parent-signature";
};

export type PostmarkBasicAuthVerifierOptions = {
  /** The basic auth username configured on the Postmark webhook URL. */
  username: string;
  /** The basic auth password configured on the Postmark webhook URL. */
  password: string;
};

const maxBatchSize = 100;

const encoder = new TextEncoder();

/** Verifies Resend webhooks with the Svix signature headers. Rejects every other provider. */
export function resendWebhookVerifier(options: ResendWebhookVerifierOptions): ConvexEmailWebhookVerifier {
  return async ({ provider, body, headers }) => {
    if (provider !== "resend") {
      return false;
    }

    return await verifyResendWebhook({
      body,
      headers,
      secret: options.secret,
      toleranceSeconds: options.toleranceSeconds,
    });
  };
}

/**
 * Verifies Mailgun webhooks with the HMAC in the JSON body. Mailgun signs the timestamp and token,
 * not the body, so keep the route on TLS. Rejects every other provider.
 */
export function mailgunWebhookVerifier(options: MailgunWebhookVerifierOptions): ConvexEmailWebhookVerifier {
  return async ({ provider, body }) => {
    if (provider !== "mailgun") {
      return false;
    }

    return await verifyMailgunWebhook({
      body,
      secret: options.secret,
      toleranceSeconds: options.toleranceSeconds,
      signatureField: options.signatureField,
    });
  };
}

/**
 * Postmark does not sign webhooks. Configure the webhook URL with basic auth credentials
 * (`https://user:pass@.../email/webhooks/postmark`) and check them here. Rejects every other
 * provider.
 */
export function postmarkBasicAuthVerifier(options: PostmarkBasicAuthVerifierOptions): ConvexEmailWebhookVerifier {
  if (!options.username || !options.password) {
    throw new Error("postmarkBasicAuthVerifier requires a non-empty username and password.");
  }

  const expected = `Basic ${base64Utf8(`${options.username}:${options.password}`)}`;

  return async ({ provider, headers }) => {
    if (provider !== "postmark") {
      return false;
    }

    return await constantTimeEqual(headers["authorization"] ?? "", expected);
  };
}

/**
 * Routes each webhook to the verifier registered for its provider. A provider without a verifier
 * is rejected.
 */
export function verifyByProvider(
  verifiers: Readonly<Record<string, ConvexEmailWebhookVerifier>>,
): ConvexEmailWebhookVerifier {
  const byProvider = new Map(Object.entries(verifiers));

  return async (input) => {
    const verifier = byProvider.get(input.provider);

    return verifier ? await verifier(input) : false;
  };
}

function base64Utf8(value: string) {
  let binary = "";

  for (const byte of encoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

/** Compares SHA-256 digests so the comparison time does not depend on where the inputs differ. */
async function constantTimeEqual(actual: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export type ConvexEmailOptions = {
  adapters?: ConvexEmailAdapterConfig[];
  defaultAdapter?: string;
  fallbackAdapters?: string[];
  maxAttempts?: number;
  retryBaseMs?: number;
};

export type ConvexEmailExposeApiOptions = {
  /**
   * Maps an authenticated caller to the stable owner id stored on emails created through this API.
   * Return `null` to deny the request. Defaults to the Convex identity's `subject`.
   */
  authorize?: ConvexEmailPublicAuthorizer;
  /**
   * Exposes setConfig/getConfig as public Convex functions. This requires an explicit admin
   * authorizer because configuration controls every sender using the component.
   */
  includeConfigApi?: boolean;
  authorizeConfig?: ConvexEmailConfigAuthorizer;
};

export type ConvexEmailPublicOperation =
  | "send"
  | "sendBatch"
  | "status"
  | "listEvents"
  | "cancel"
  | "retry";

export type ConvexEmailPublicAuthContext = {
  auth: {
    getUserIdentity(): Promise<{ subject: string; tokenIdentifier: string } | null>;
  };
};

export type ConvexEmailPublicAuthorizer = (
  ctx: ConvexEmailPublicAuthContext,
  operation: ConvexEmailPublicOperation,
) => Promise<string | null> | string | null;

export type ConvexEmailConfigAuthorizer = (
  ctx: ConvexEmailPublicAuthContext,
) => Promise<boolean> | boolean;

export class ConvexEmail {
  constructor(
    private readonly component: ConvexEmailComponentApi,
    private readonly options: ConvexEmailOptions = {},
  ) {}

  send(ctx: MutationCtx, args: ConvexEmailSendArgs) {
    return ctx.runMutation(this.component.lib.enqueue, this.withDefaults(args));
  }

  sendBatch(ctx: MutationCtx, messages: ConvexEmailSendArgs[]) {
    if (messages.length > maxBatchSize) {
      throw new Error(`sendBatch accepts at most ${maxBatchSize} messages per mutation.`);
    }

    return ctx.runMutation(this.component.lib.enqueueBatch, {
      messages: messages.map((message) => this.withDefaults(message)),
    });
  }

  status(ctx: QueryCtx, args: { emailId: string }) {
    return ctx.runQuery(this.component.lib.status, args);
  }

  listEvents(ctx: QueryCtx, args: { emailId: string }) {
    return ctx.runQuery(this.component.lib.listEvents, args);
  }

  cancel(ctx: MutationCtx, args: { emailId: string }) {
    return ctx.runMutation(this.component.lib.cancel, args);
  }

  retry(ctx: MutationCtx, args: { emailId: string }) {
    return ctx.runMutation(this.component.lib.retry, args);
  }

  setConfig(ctx: MutationCtx, config: ConvexEmailConfig) {
    return ctx.runMutation(this.component.lib.setConfig, { config });
  }

  getConfig(ctx: QueryCtx) {
    return ctx.runQuery(this.component.lib.getConfig, {});
  }

  /** Records a webhook that the caller has already authenticated. */
  processWebhook(
    ctx: ActionCtx,
    args: { provider: string; headers: Record<string, string>; body: string },
  ) {
    return ctx.runAction(this.component.worker.handleWebhook, args);
  }

  /**
   * Registers `POST <pathPrefix>/webhooks/<provider>` routes. Every request must pass `verify`
   * before it reaches the component; registration throws when no verifier is configured, unless
   * `unsafeAllowUnverifiedWebhooks: true` opts out for local development.
   */
  registerRoutes(router: HttpRouterLike, options: ConvexEmailRegisterRoutesOptions = {}) {
    const pathPrefix = options.pathPrefix ?? "/email";
    const providers = options.providers ?? ["resend"];
    const verify = options.verify;

    if (!verify && options.unsafeAllowUnverifiedWebhooks !== true) {
      throw new Error(
        "registerRoutes() requires a webhook verifier. Pass verify: verifyByProvider({ resend: resendWebhookVerifier({ secret }) }), or set unsafeAllowUnverifiedWebhooks: true for local development only.",
      );
    }

    if (!verify) {
      console.warn(
        `convex-email: webhook routes under ${pathPrefix}/webhooks accept unverified requests. Do not deploy this configuration.`,
      );
    }

    for (const provider of providers) {
      router.route({
        path: `${pathPrefix}/webhooks/${provider}`,
        method: "POST",
        handler: httpActionGeneric(async (ctx, request) => {
          const headers = Object.fromEntries(request.headers.entries());
          const body = await request.text();

          if (verify && !(await verify({ provider, request, body, headers }))) {
            return new Response("Unauthorized", { status: 401 });
          }

          const result = await this.processWebhook(ctx, { provider, headers, body });

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }),
      });
    }
  }

  exposeApi(options: ConvexEmailExposeApiOptions = {}) {
    const authorizeConfig = options.authorizeConfig;

    if (options.includeConfigApi && !authorizeConfig) {
      throw new Error(
        "exposeApi({ includeConfigApi: true }) requires authorizeConfig to prevent public configuration access.",
      );
    }

    const publicApi = {
      send: mutationGeneric({
        args: vSendEmailArgs,
        returns: v.string(),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "send", options.authorize);

          return await this.sendForOwner(ctx, args, ownerId);
        },
      }),
      sendBatch: mutationGeneric({
        args: vSendBatchEmailsArgs,
        returns: v.array(v.string()),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "sendBatch", options.authorize);

          return await this.sendBatchForOwner(ctx, args.messages, ownerId);
        },
      }),
      status: queryGeneric({
        args: vStatusArgs,
        returns: v.union(vEmailRecord, v.null()),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "status", options.authorize);

          return await this.ownedEmail(ctx, args.emailId, ownerId);
        },
      }),
      listEvents: queryGeneric({
        args: vListEmailEventsArgs,
        returns: v.array(vEmailEventRecord),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "listEvents", options.authorize);
          const email = await this.ownedEmail(ctx, args.emailId, ownerId);

          return email ? await this.listEvents(ctx, args) : [];
        },
      }),
      cancel: mutationGeneric({
        args: vCancelEmailArgs,
        returns: v.boolean(),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "cancel", options.authorize);

          return (await this.ownedEmail(ctx, args.emailId, ownerId))
            ? await this.cancel(ctx, args)
            : false;
        },
      }),
      retry: mutationGeneric({
        args: vRetryEmailArgs,
        returns: v.boolean(),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "retry", options.authorize);

          return (await this.ownedEmail(ctx, args.emailId, ownerId))
            ? await this.retry(ctx, args)
            : false;
        },
      }),
    };

    if (!options.includeConfigApi || !authorizeConfig) {
      return publicApi;
    }

    return {
      ...publicApi,
      getConfig: queryGeneric({
        args: {},
        returns: v.union(vEmailConfig, v.null()),
        handler: async (ctx) => {
          await this.authorizeConfig(ctx, authorizeConfig);

          return await this.getConfig(ctx);
        },
      }),
      setConfig: mutationGeneric({
        args: { config: vEmailConfig },
        returns: v.null(),
        handler: async (ctx, args) => {
          await this.authorizeConfig(ctx, authorizeConfig);
          await this.setConfig(ctx, args.config);

          return null;
        },
      }),
    };
  }

  private withDefaults(args: ConvexEmailSendArgs): ConvexEmailSendArgs {
    return {
      ...args,
      adapters: args.adapters ?? this.options.adapters,
      adapter: args.adapter ?? this.options.defaultAdapter,
      fallbackAdapters: args.fallbackAdapters ?? this.options.fallbackAdapters,
      maxAttempts: args.maxAttempts ?? this.options.maxAttempts,
      retryBaseMs: args.retryBaseMs ?? this.options.retryBaseMs,
    };
  }

  private async sendForOwner(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation">,
    args: ConvexEmailSendArgs,
    ownerId: string,
  ) {
    return await ctx.runMutation(this.component.lib.enqueueOwned, {
      email: this.withDefaults(args),
      ownerId,
    });
  }

  private async sendBatchForOwner(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation">,
    messages: ConvexEmailSendArgs[],
    ownerId: string,
  ) {
    return await ctx.runMutation(this.component.lib.enqueueOwnedBatch, {
      messages: messages.map((message) => this.withDefaults(message)),
      ownerId,
    });
  }

  private async ownedEmail(ctx: QueryCtx, emailId: string, ownerId: string) {
    const email = await this.status(ctx, { emailId });

    return email?.ownerId === ownerId ? email : null;
  }

  private async authorizePublic(
    ctx: PublicContext,
    operation: ConvexEmailPublicOperation,
    authorize: ConvexEmailPublicAuthorizer | undefined,
  ) {
    const ownerId = authorize
      ? await authorize(ctx, operation)
      : (await ctx.auth.getUserIdentity())?.subject ?? null;

    if (!ownerId) {
      throw new Error("Unauthorized");
    }

    return ownerId;
  }

  private async authorizeConfig(ctx: PublicContext, authorize: ConvexEmailConfigAuthorizer) {
    if (!(await authorize(ctx))) {
      throw new Error("Unauthorized");
    }
  }
}

export type { ConvexEmailComponentApi };

export type {
  ConvexEmailAdapterConfig,
  ConvexEmailConfig,
  ConvexEmailDeliveryStatus,
  ConvexEmailDoc,
  ConvexEmailEventDoc,
  ConvexEmailMessage,
  ConvexEmailProviderFailure,
  ConvexEmailSendArgs,
};

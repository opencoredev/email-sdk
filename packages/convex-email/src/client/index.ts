import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  FunctionReference,
} from "convex/server";
import { httpActionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import type {
  ConvexEmailAdapterConfig,
  ConvexEmailConfig,
  ConvexEmailDeliveryStatus,
  ConvexEmailDoc,
  ConvexEmailEventDoc,
  ConvexEmailMessage,
  ConvexEmailSendArgs,
} from "../shared/types.js";
import {
  vCancelEmailArgs,
  vEmailConfig,
  vListEmailEventsArgs,
  vRetryEmailArgs,
  vSendBatchEmailsArgs,
  vSendEmailArgs,
  vStatusArgs,
  vStoredEmail,
  vStoredEmailEvent,
} from "../shared/validators.js";

type ComponentApi = {
  lib: {
    enqueue: unknown;
    enqueueOwned: unknown;
    enqueueOwnedBatch: unknown;
    enqueueBatch: unknown;
    status: unknown;
    listEvents: unknown;
    cancel: unknown;
    retry: unknown;
    setConfig: unknown;
    getConfig: unknown;
  };
  worker: {
    handleWebhook: unknown;
  };
};

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type ActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
type PublicMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "runQuery" | "auth">;
type PublicQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery" | "auth">;
type PublicContext = PublicMutationCtx | PublicQueryCtx;
type AnyMutationRef = FunctionReference<"mutation", "public", Record<string, unknown>, unknown>;
type AnyQueryRef = FunctionReference<"query", "public", Record<string, unknown>, unknown>;
type AnyActionRef = FunctionReference<
  "action",
  "public" | "internal",
  Record<string, unknown>,
  unknown
>;
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS" | "PATCH";
type HttpRouterLike = {
  route(route: {
    path: string;
    method: HttpMethod;
    handler: ReturnType<typeof httpActionGeneric>;
  }): void;
};
type WebhookVerifier = (input: {
  provider: string;
  request: Request;
  body: string;
  headers: Record<string, string>;
}) => boolean | Promise<boolean>;
const maxBatchSize = 100;

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
    private readonly component: ComponentApi,
    private readonly options: ConvexEmailOptions = {},
  ) {}

  send(ctx: MutationCtx, args: ConvexEmailSendArgs) {
    return ctx.runMutation(
      this.component.lib.enqueue as AnyMutationRef,
      this.withDefaults(args),
    ) as Promise<string>;
  }

  sendBatch(ctx: MutationCtx, messages: ConvexEmailSendArgs[]) {
    if (messages.length > maxBatchSize) {
      throw new Error(`sendBatch accepts at most ${maxBatchSize} messages per mutation.`);
    }

    return ctx.runMutation(this.component.lib.enqueueBatch as AnyMutationRef, {
      messages: messages.map((message) => this.withDefaults(message)),
    }) as Promise<string[]>;
  }

  status(ctx: QueryCtx, args: { emailId: string }) {
    return ctx.runQuery(
      this.component.lib.status as AnyQueryRef,
      args,
    ) as Promise<ConvexEmailDoc | null>;
  }

  listEvents(ctx: QueryCtx, args: { emailId: string }) {
    return ctx.runQuery(this.component.lib.listEvents as AnyQueryRef, args) as Promise<
      ConvexEmailEventDoc[]
    >;
  }

  cancel(ctx: MutationCtx, args: { emailId: string }) {
    return ctx.runMutation(this.component.lib.cancel as AnyMutationRef, args) as Promise<boolean>;
  }

  retry(ctx: MutationCtx, args: { emailId: string }) {
    return ctx.runMutation(this.component.lib.retry as AnyMutationRef, args) as Promise<boolean>;
  }

  setConfig(ctx: MutationCtx, config: ConvexEmailConfig) {
    return ctx.runMutation(this.component.lib.setConfig as AnyMutationRef, {
      config,
    }) as Promise<null>;
  }

  getConfig(ctx: QueryCtx) {
    return ctx.runQuery(
      this.component.lib.getConfig as AnyQueryRef,
      {},
    ) as Promise<ConvexEmailConfig | null>;
  }

  processWebhook(
    ctx: ActionCtx,
    args: { provider: string; headers: Record<string, string>; body: string },
  ) {
    return ctx.runAction(this.component.worker.handleWebhook as AnyActionRef, args) as Promise<{
      ok: boolean;
      duplicate?: boolean;
    }>;
  }

  registerRoutes(
    router: HttpRouterLike,
    options: {
      pathPrefix?: string;
      providers?: string[];
      /**
       * Public webhook routes should pass a provider-specific signature or shared-secret verifier.
       * Omitting this is intended for local development only.
       */
      verify?: WebhookVerifier;
    } = {},
  ) {
    const pathPrefix = options.pathPrefix ?? "/email";
    const providers = options.providers ?? ["resend"];

    for (const provider of providers) {
      router.route({
        path: `${pathPrefix}/webhooks/${provider}`,
        method: "POST",
        handler: httpActionGeneric(async (ctx, request) => {
          const headers = Object.fromEntries(request.headers.entries());
          const body = await request.text();

          if (options.verify) {
            const verified = await options.verify({ provider, request, body, headers });
            if (!verified) {
              return new Response("Unauthorized", { status: 401 });
            }
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
    if (options.includeConfigApi && !options.authorizeConfig) {
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
        returns: v.union(vStoredEmail, v.null()),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "status", options.authorize);
          return (await this.ownedEmail(ctx, args.emailId, ownerId)) as any;
        },
      }),
      listEvents: queryGeneric({
        args: vListEmailEventsArgs,
        returns: v.array(vStoredEmailEvent),
        handler: async (ctx, args) => {
          const ownerId = await this.authorizePublic(ctx, "listEvents", options.authorize);
          const email = await this.ownedEmail(ctx, args.emailId, ownerId);
          return (email ? await this.listEvents(ctx, args) : []) as any;
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

    if (!options.includeConfigApi) {
      return publicApi;
    }

    return {
      ...publicApi,
      getConfig: queryGeneric({
        args: {},
        returns: v.union(vEmailConfig, v.null()),
        handler: async (ctx) => {
          await this.authorizeConfig(ctx, options.authorizeConfig!);
          return (await this.getConfig(ctx)) as any;
        },
      }),
      setConfig: mutationGeneric({
        args: { config: vEmailConfig },
        returns: v.null(),
        handler: async (ctx, args) => {
          await this.authorizeConfig(ctx, options.authorizeConfig!);
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
    return (await ctx.runMutation(this.component.lib.enqueueOwned as AnyMutationRef, {
      email: this.withDefaults(args),
      ownerId,
    })) as string;
  }

  private async sendBatchForOwner(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation">,
    messages: ConvexEmailSendArgs[],
    ownerId: string,
  ) {
    return (await ctx.runMutation(this.component.lib.enqueueOwnedBatch as AnyMutationRef, {
      messages: messages.map((message) => this.withDefaults(message)),
      ownerId,
    })) as string[];
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

export type {
  ConvexEmailAdapterConfig,
  ConvexEmailConfig,
  ConvexEmailDeliveryStatus,
  ConvexEmailDoc,
  ConvexEmailEventDoc,
  ConvexEmailMessage,
  ConvexEmailSendArgs,
};

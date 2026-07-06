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
  vSendBatchEmailsArgs,
  vSendEmailArgs,
  vStatusArgs,
  vStoredEmail,
  vStoredEmailEvent,
} from "../shared/validators.js";

type ComponentApi = {
  lib: {
    enqueue: unknown;
    enqueueBatch: unknown;
    status: unknown;
    listEvents: unknown;
    cancel: unknown;
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
   * Exposes setConfig/getConfig as public Convex functions.
   * Only enable this behind your own auth checks or for trusted server-only modules.
   */
  includeConfigApi?: boolean;
};

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
    const publicApi = {
      send: mutationGeneric({
        args: vSendEmailArgs,
        returns: v.string(),
        handler: async (ctx, args) => await this.send(ctx, args),
      }),
      sendBatch: mutationGeneric({
        args: vSendBatchEmailsArgs,
        returns: v.array(v.string()),
        handler: async (ctx, args) => await this.sendBatch(ctx, args.messages),
      }),
      status: queryGeneric({
        args: vStatusArgs,
        returns: v.union(vStoredEmail, v.null()),
        handler: async (ctx, args) => (await this.status(ctx, args)) as any,
      }),
      listEvents: queryGeneric({
        args: vListEmailEventsArgs,
        returns: v.array(vStoredEmailEvent),
        handler: async (ctx, args) => (await this.listEvents(ctx, args)) as any,
      }),
      cancel: mutationGeneric({
        args: vCancelEmailArgs,
        returns: v.boolean(),
        handler: async (ctx, args) => await this.cancel(ctx, args),
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
        handler: async (ctx) => (await this.getConfig(ctx)) as any,
      }),
      setConfig: mutationGeneric({
        args: { config: vEmailConfig },
        returns: v.null(),
        handler: async (ctx, args) => {
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

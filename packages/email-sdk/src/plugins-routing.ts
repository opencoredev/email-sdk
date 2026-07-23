import type { EmailBeforeSendEvent, EmailPlugin, MaybePromise } from "./types.js";

export type EmailRoutingPluginOptions<Name extends string = string> = {
  id?: string;
  select: (event: EmailBeforeSendEvent) => MaybePromise<Name | undefined>;
};

export function routingPlugin<Name extends string>(
  options: EmailRoutingPluginOptions<Name>,
): EmailPlugin {
  return {
    id: options.id ?? "routing",
    middleware: [
      {
        async beforeSend(event) {
          const adapter = await options.select(event);
          if (!adapter) return;

          return {
            options: {
              ...event.options,
              adapter,
            },
          };
        },
      },
    ],
  };
}

import { EmailProviderNotFoundError, EmailValidationError } from "./errors.js";
import type {
  InboundEmail,
  InboundEmailAdapter,
  InboundEmailClient,
  InboundEmailClientOptions,
} from "./inbound-types.js";

export function createInboundEmailClient(options: InboundEmailClientOptions): InboundEmailClient {
  const adapterList = options.adapters ?? [];

  if (adapterList.length === 0) {
    throw new EmailValidationError("createInboundEmailClient requires at least one adapter.");
  }

  const adapters = new Map<string, InboundEmailAdapter>();

  for (const adapter of adapterList) {
    if (adapters.has(adapter.name)) {
      throw new EmailValidationError(`Duplicate inbound email adapter "${adapter.name}".`);
    }

    adapters.set(adapter.name, adapter);
  }

  const defaultAdapter = options.defaultAdapter ?? adapterList[0]?.name;

  if (!defaultAdapter) {
    throw new EmailValidationError("createInboundEmailClient requires a default adapter.");
  }

  if (!adapters.has(defaultAdapter)) {
    throw new EmailProviderNotFoundError(defaultAdapter);
  }

  const client: InboundEmailClient = {
    adapters,
    defaultAdapter,
    adapter<TAdapter extends InboundEmailAdapter = InboundEmailAdapter>(name: string) {
      const adapter = adapters.get(name);

      if (!adapter) {
        throw new EmailProviderNotFoundError(name);
      }

      return adapter as TAdapter;
    },
    async parse(input, parseOptions) {
      const adapter = client.adapter(parseOptions?.adapter ?? defaultAdapter);
      const email = await adapter.parse(input, {
        signal: parseOptions?.signal,
        metadata: parseOptions?.metadata,
      });

      return normalizeInboundEmail(email, adapter.name);
    },
    async verify(input, verifyOptions) {
      const adapter = client.adapter(verifyOptions?.adapter ?? defaultAdapter);

      if (!adapter.verify) {
        return true;
      }

      return adapter.verify(input);
    },
  };

  return client;
}

function normalizeInboundEmail(email: InboundEmail, provider: string): InboundEmail {
  return {
    ...email,
    provider: email.provider || provider,
    headers: email.headers ?? {},
    attachments: email.attachments ?? [],
  };
}

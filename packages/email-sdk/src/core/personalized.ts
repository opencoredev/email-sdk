import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import type {
  EmailAdapter,
  EmailHooks,
  EmailMessage,
  EmailPersonalizedInput,
  EmailPersonalizedResult,
  EmailRetryConfig,
  EmailSendMiddleware,
  EmailSendOptions,
  EmailSendResult,
} from "../types.js";
import { emailAddressOf, normalizeAdapterResult } from "../utils.js";
import { attemptAdapter, defaultDelay, type MeasureAttempt } from "./attempts.js";
import {
  failureAttempt,
  isAbort,
  normalizeAdapterFailure,
  sleep,
  throwIfAborted,
} from "./failures.js";
import {
  hookEvent,
  invokeAfterSendMiddleware,
  invokeHooks,
  invokeSendFailureLifecycle,
} from "./lifecycle.js";

export async function attemptNativePersonalized(
  adapter: EmailAdapter,
  input: EmailPersonalizedInput,
  hookMessage: EmailMessage,
  sendOptions: EmailSendOptions | undefined,
  clientRetry: EmailRetryConfig | undefined,
  hooks: EmailHooks[],
  middleware: EmailSendMiddleware[],
  measureAttempt: MeasureAttempt,
): Promise<PersonalizedAttempt> {
  const maxAttempts = sendOptions?.retry?.maxAttempts ?? clientRetry?.maxAttempts ?? 1;
  const retry = sendOptions?.retry ?? clientRetry;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(sendOptions?.signal);
    const event = hookEvent(adapter.name, hookMessage, attempt, sendOptions?.metadata);
    await invokeHooks(hooks, "beforeSend", event);

    try {
      const result = await measureAttempt(
        adapter,
        "personalized_native",
        input.recipients.length,
        () =>
          adapter.sendPersonalized!(input, {
            adapter: adapter.name,
            operation: "personalized",
            attempt,
            signal: sendOptions?.signal,
            idempotencyKey: sendOptions?.idempotencyKey,
            metadata: sendOptions?.metadata,
          }),
      );

      throwIfAborted(sendOptions?.signal);
      const normalized = normalizeAdapterResult(adapter.name, result);

      const personalized = {
        ...normalized,
        accepted: result.accepted,
        rejected: result.rejected,
      };

      if (personalized.accepted.length > 0) {
        await invokeAfterSendMiddleware(middleware, { ...event, response: personalized });
        await invokeHooks(hooks, "afterSend", { ...event, response: personalized });

        return { ...personalized, failures: [] };
      }

      const failure = new EmailAdapterError(
        `${adapter.name} rejected every personalized recipient.`,
        {
          adapter: adapter.name,
          delivery: "not_sent",
        },
      );

      await invokeSendFailureLifecycle(middleware, hooks, {
        ...event,
        error: failure,
      });

      return {
        ...personalized,
        failures: [failure],
      };
    } catch (error) {
      if (isAbort(error, sendOptions?.signal)) throw new EmailAbortError(error);

      if (error instanceof EmailMiddlewareError || error instanceof EmailValidationError)
        throw error;
      const failure = normalizeAdapterFailure(adapter.name, error);

      const canRetry =
        attempt < maxAttempts && (retry?.shouldRetry ?? isRetryableEmailError)(failure, attempt);

      if (!canRetry) {
        await invokeSendFailureLifecycle(middleware, hooks, {
          ...event,
          error: failure,
        });

        return { adapter: adapter.name, accepted: [], rejected: [], failures: [failure] };
      }

      const delayMs = Math.max(0, (retry?.delay ?? defaultDelay)(attempt, failure));
      await invokeHooks(hooks, "onRetry", {
        ...event,
        error: failure,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs, sendOptions?.signal);
    }
  }

  return { adapter: adapter.name, accepted: [], rejected: [], failures: [] };
}

export type ExpandedRecipient = {
  recipient: EmailPersonalizedInput["recipients"][number];
  message: EmailMessage;
};

export type PersonalizedAttempt = EmailPersonalizedResult & {
  failures: EmailAdapterError[];
};

export async function attemptExpandedPersonalized(
  adapter: EmailAdapter,
  expanded: readonly ExpandedRecipient[],
  sendOptions: EmailSendOptions | undefined,
  clientRetry: EmailRetryConfig | undefined,
  hooks: EmailHooks[],
  middleware: EmailSendMiddleware[],
  measureAttempt: MeasureAttempt,
): Promise<PersonalizedAttempt> {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const failures: EmailAdapterError[] = [];
  let firstResult: EmailSendResult | undefined;

  for (const { recipient, message } of expanded) {
    const address = emailAddressOf(recipient.to);

    try {
      const result = await attemptAdapter({
        adapter,
        message,
        options: {
          ...sendOptions,
          fallback: undefined,
          idempotencyKey: recipientIdempotencyKey(sendOptions?.idempotencyKey, address),
        },
        retry: sendOptions?.retry ?? clientRetry,
        hooks,
        middleware,
        measureAttempt,
        path: "personalized_expanded",
      });

      firstResult ??= result;
      accepted.push(address);
    } catch (error) {
      if (
        error instanceof EmailAbortError ||
        error instanceof EmailMiddlewareError ||
        error instanceof EmailValidationError
      ) {
        throw error;
      }

      rejected.push(address);
      const failure = normalizeAdapterFailure(adapter.name, error);
      failures.push(failure);
      await invokeSendFailureLifecycle(middleware, hooks, {
        adapter: adapter.name,
        message,
        attempt: failureAttempt(error),
        metadata: sendOptions?.metadata,
        error: failure,
      });
    }
  }

  return {
    adapter: adapter.name,
    id: firstResult?.id,
    raw: firstResult?.raw,
    accepted,
    rejected,
    failures,
  };
}

export function validatePersonalizedInput(input: EmailPersonalizedInput) {
  if (input.recipients.length === 0) {
    throw new EmailValidationError("sendPersonalized requires at least one recipient.");
  }

  const recipients = new Set<string>();

  for (const recipient of input.recipients) {
    const address = emailAddressOf(recipient.to).toLowerCase();

    if (!address)
      throw new EmailValidationError("Personalized recipients require an email address.");

    if (recipients.has(address)) {
      throw new EmailValidationError(`Personalized recipient "${address}" appears more than once.`);
    }

    recipients.add(address);

    for (const key of Object.keys(recipient.variables)) {
      if (!/^[\w-]+$/.test(key)) {
        throw new EmailValidationError(
          `Personalized variable keys may only contain letters, numbers, underscores, and hyphens: "${key}".`,
        );
      }
    }
  }
}

export function personalizedMiddlewareMessage(input: EmailPersonalizedInput): EmailMessage {
  const to = input.recipients[0]?.to ?? "";

  // SAFETY: input.message is an EmailMessage without recipients. Omit flattens the html-or-text
  // union, but the template still carries html or text, so adding `to` restores an EmailMessage.
  // The empty `to` only reaches middleware; validatePersonalizedInput rejects empty recipients.
  return { ...input.message, to } as EmailMessage;
}

export function withPersonalizedMessage(
  input: EmailPersonalizedInput,
  message: EmailMessage,
): EmailPersonalizedInput {
  const { to: _to, cc: _cc, bcc: _bcc, ...template } = message;

  return {
    // SAFETY: Removing to, cc, and bcc from an EmailMessage leaves exactly the template shape.
    message: template as EmailPersonalizedInput["message"],
    recipients: input.recipients,
  };
}

export function expandPersonalizedMessage(
  input: EmailPersonalizedInput,
  to: EmailPersonalizedInput["recipients"][number]["to"],
  variables: EmailPersonalizedInput["recipients"][number]["variables"],
): EmailMessage {
  const render = (value: string | undefined) =>
    value?.replace(/%recipient\.([\w-]+)%/g, (_match, key: string) =>
      Object.hasOwn(variables, key) ? String(variables[key]) : `%recipient.${key}%`,
    );

  // SAFETY: The template has html or text, and each is rendered only when present, so the
  // result keeps the html-or-text shape of an EmailMessage.
  return {
    ...input.message,
    to,
    subject: render(input.message.subject) ?? input.message.subject,
    html: render(input.message.html),
    text: render(input.message.text),
  } as EmailMessage;
}

export function recipientIdempotencyKey(base: string | undefined, address: string) {
  return base ? `${base}:${address}` : undefined;
}

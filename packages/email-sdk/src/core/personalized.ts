import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import { isNonArrayObject, isStringMember } from "../internal/decode.js";
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
import { emailAddressOf, isValidAddress, normalizeAdapterResult } from "../utils.js";
import {
  attemptAdapter,
  defaultDelay,
  withUnknownDelivery,
  type MeasureAttempt,
} from "./attempts.js";
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
import { cloneNestedSendOptions } from "./routing.js";

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
  const retry = sendOptions?.retry ?? clientRetry;
  const maxAttempts = retry?.maxAttempts ?? 1;
  // See attemptAdapter: after an attempt with an unknown outcome, nothing later proves not_sent.
  let earlierOutcomeUnknown = false;

  // Every pass returns, throws, or retries while attempt < maxAttempts (validated >= 1), so the
  // loop needs no exit condition and no unreachable fallback result after it.
  for (let attempt = 1; ; attempt += 1) {
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
      const personalized = personalizedResult(adapter.name, result);

      if (personalized.accepted.length > 0) {
        await invokeAfterSendMiddleware(middleware, { ...event, response: personalized });
        await invokeHooks(hooks, "afterSend", { ...event, response: personalized });

        return { ...personalized, failures: [] };
      }

      const failure = new EmailAdapterError(
        `${adapter.name} rejected every personalized recipient.`,
        {
          adapter: adapter.name,
          delivery: earlierOutcomeUnknown ? "unknown" : "not_sent",
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
        const finalFailure = earlierOutcomeUnknown ? withUnknownDelivery(failure) : failure;
        await invokeSendFailureLifecycle(middleware, hooks, {
          ...event,
          error: finalFailure,
        });

        return { adapter: adapter.name, accepted: [], rejected: [], failures: [finalFailure] };
      }

      if (failure.delivery === "unknown") earlierOutcomeUnknown = true;

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
}

/**
 * Checks a native personalized result before core reads it. The type requires `accepted` and
 * `rejected`, but a plain JavaScript or custom adapter can omit them. A missing `rejected` list
 * means nothing was reported rejected. A missing `accepted` list is an adapter defect: the call
 * resolved, so the provider may have sent, and the failure reports `unknown` delivery instead of
 * letting a `TypeError` escape or treating every recipient as rejected (which would allow a
 * duplicate-sending fallback).
 */
function personalizedResult(
  adapterName: string,
  result: EmailPersonalizedResult,
): EmailPersonalizedResult {
  const normalized = normalizeAdapterResult(adapterName, result);

  if (!Array.isArray(result.accepted)) {
    throw new EmailAdapterError(
      `${adapterName}.sendPersonalized resolved without an accepted recipient list.`,
      { adapter: adapterName, delivery: "unknown", retryable: false },
    );
  }

  return {
    ...normalized,
    accepted: result.accepted,
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
  };
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
        options: sendOptions
          ? cloneNestedSendOptions({
              ...sendOptions,
              fallback: undefined,
              idempotencyKey: recipientIdempotencyKey(sendOptions.idempotencyKey, address),
            })
          : undefined,
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
  if (!isNonArrayObject(input)) {
    throw new EmailValidationError("sendPersonalized input must be an object.");
  }

  if (!isNonArrayObject(input.message)) {
    throw new EmailValidationError("sendPersonalized message must be an object.");
  }

  if (!isStringMember(input.message.subject) || input.message.subject.length === 0) {
    throw new EmailValidationError("sendPersonalized message requires a string subject.");
  }

  if (input.message.html !== undefined && !isStringMember(input.message.html)) {
    throw new EmailValidationError("sendPersonalized message html content must be a string.");
  }

  if (input.message.text !== undefined && !isStringMember(input.message.text)) {
    throw new EmailValidationError("sendPersonalized message text content must be a string.");
  }

  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    throw new EmailValidationError("sendPersonalized requires at least one recipient.");
  }

  const recipients = new Set<string>();

  for (const recipient of input.recipients) {
    if (!isNonArrayObject(recipient)) {
      throw new EmailValidationError("Each personalized recipient must be an object.");
    }

    if (recipient.variables !== undefined && !isNonArrayObject(recipient.variables)) {
      throw new EmailValidationError("Personalized recipient variables must be an object.");
    }

    if (!isValidAddress(recipient.to)) {
      throw new EmailValidationError("Personalized recipients require a valid email address.");
    }

    const address = emailAddressOf(recipient.to).toLowerCase();

    if (!address)
      throw new EmailValidationError("Personalized recipients require an email address.");

    if (recipients.has(address)) {
      throw new EmailValidationError(`Personalized recipient "${address}" appears more than once.`);
    }

    recipients.add(address);

    if (recipient.variables) {
      for (const key of Object.keys(recipient.variables)) {
        if (!/^[\w-]+$/.test(key)) {
          throw new EmailValidationError(
            `Personalized variable keys may only contain letters, numbers, underscores, and hyphens: "${key}".`,
          );
        }

        try {
          String(recipient.variables[key]);
        } catch {
          throw new EmailValidationError(
            `Personalized variable "${key}" cannot be converted to a string.`,
          );
        }
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
  const vars = isNonArrayObject(variables) ? variables : undefined;

  const render = (value: string | undefined) =>
    isStringMember(value)
      ? value.replace(/%recipient\.([\w-]+)%/g, (_match, key: string) =>
          vars && Object.hasOwn(vars, key) ? String(vars[key]) : `%recipient.${key}%`,
        )
      : undefined;

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

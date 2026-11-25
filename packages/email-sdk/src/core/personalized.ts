import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import { cloneMetadataRecord, isNonArrayObject, isStringMember } from "../internal/decode.js";
import { snapshotMessage, snapshotPersonalizedInputForSend } from "../internal/snapshot.js";
import type {
  EmailAdapter,
  EmailHooks,
  EmailMessage,
  EmailNativeOptionsMap,
  EmailPersonalizedInput,
  EmailPersonalizedResult,
  EmailRetryConfig,
  EmailSendMiddleware,
  EmailNativeSendOptions,
  EmailSendResult,
} from "../types.js";
import { emailAddressOf, isValidAddress, normalizePersonalizedAdapterResult } from "../utils.js";
import {
  attemptAdapter,
  defaultDelay,
  nativeEntryFor,
  RECIPIENT_REPLACING_NATIVE_KEYS,
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
  cloneAdapterError,
  hookEvent,
  invokeAfterSendMiddleware,
  invokeErrorMiddleware,
  invokeHooks,
} from "./lifecycle.js";
import { cloneNestedSendOptions } from "./routing.js";

export async function attemptNativePersonalized(
  adapter: EmailAdapter,
  input: EmailPersonalizedInput,
  hookMessage: EmailMessage,
  sendOptions: EmailNativeSendOptions | undefined,
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

    const freshEvent = () =>
      hookEvent(
        adapter.name,
        snapshotMessage(hookMessage),
        attempt,
        sendOptions?.metadata ? cloneMetadataRecord(sendOptions.metadata) : undefined,
      );

    await invokeHooks(hooks, "beforeSend", freshEvent);

    try {
      const attemptInput = snapshotPersonalizedInputForSend(input);

      const attemptMetadata = sendOptions?.metadata
        ? cloneMetadataRecord(sendOptions.metadata)
        : undefined;

      const native = nativeEntryFor(sendOptions?.native, adapter.name);

      const personalized = await measureAttempt(
        adapter,
        "personalized_native",
        input.recipients.length,
        async () =>
          personalizedResult(
            adapter.name,
            await adapter.sendPersonalized!(attemptInput, {
              adapter: adapter.name,
              operation: "personalized",
              attempt,
              signal: sendOptions?.signal,
              idempotencyKey: sendOptions?.idempotencyKey,
              metadata: attemptMetadata,
              native,
            }),
          ),
        native,
      );

      throwIfAborted(sendOptions?.signal);

      if (personalized.accepted.length > 0) {
        if (middleware.length > 0) {
          await invokeAfterSendMiddleware(middleware, () => ({
            ...freshEvent(),
            response: {
              ...personalized,
              accepted: [...personalized.accepted],
              rejected: [...personalized.rejected],
            },
          }));
        }

        if (hooks.length > 0) {
          await invokeHooks(hooks, "afterSend", () => ({
            ...freshEvent(),
            response: {
              ...personalized,
              accepted: [...personalized.accepted],
              rejected: [...personalized.rejected],
            },
          }));
        }

        return { ...personalized, failures: [] };
      }

      const rejectedSet = new Set(personalized.rejected.map((addr) => addr.toLowerCase()));

      const unreported = input.recipients.some(
        (recipient) => !rejectedSet.has(emailAddressOf(recipient.to).toLowerCase()),
      );

      const failure = new EmailAdapterError(
        unreported
          ? `${adapter.name} left one or more personalized recipients unreported.`
          : `${adapter.name} rejected every personalized recipient.`,
        {
          adapter: adapter.name,
          delivery: earlierOutcomeUnknown || unreported ? "unknown" : "not_sent",
        },
      );

      if (middleware.length > 0) {
        await invokeErrorMiddleware(middleware, () => ({
          ...freshEvent(),
          error: cloneAdapterError(failure),
        }));
      }

      if (hooks.length > 0) {
        await invokeHooks(hooks, "onError", () => ({
          ...freshEvent(),
          error: cloneAdapterError(failure),
        }));
      }

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

        if (middleware.length > 0) {
          await invokeErrorMiddleware(middleware, () => ({
            ...freshEvent(),
            error: cloneAdapterError(finalFailure),
          }));
        }

        if (hooks.length > 0) {
          await invokeHooks(hooks, "onError", () => ({
            ...freshEvent(),
            error: cloneAdapterError(finalFailure),
          }));
        }

        return { adapter: adapter.name, accepted: [], rejected: [], failures: [finalFailure] };
      }

      if (failure.delivery === "unknown") earlierOutcomeUnknown = true;

      const delayMs = Math.max(0, (retry?.delay ?? defaultDelay)(attempt, failure));
      await invokeHooks(hooks, "onRetry", () => ({
        ...freshEvent(),
        error: cloneAdapterError(failure),
        nextAttempt: attempt + 1,
        delayMs,
      }));
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
  return normalizePersonalizedAdapterResult(adapterName, result);
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
  sendOptions: EmailNativeSendOptions | undefined,
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
      const attemptNum = failureAttempt(error);

      if (middleware.length > 0) {
        await invokeErrorMiddleware(middleware, () => ({
          adapter: adapter.name,
          message: snapshotMessage(message),
          attempt: attemptNum,
          metadata: sendOptions?.metadata ? cloneMetadataRecord(sendOptions.metadata) : undefined,
          error: cloneAdapterError(failure),
        }));
      }

      if (hooks.length > 0) {
        await invokeHooks(hooks, "onError", () => ({
          adapter: adapter.name,
          message: snapshotMessage(message),
          attempt: attemptNum,
          metadata: sendOptions?.metadata ? cloneMetadataRecord(sendOptions.metadata) : undefined,
          error: cloneAdapterError(failure),
        }));
      }
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

// The personalized result must name exactly who was sent to, so the raw passthroughs that can
// replace the recipients are refused outright.
export function assertNativeKeepsRecipients(
  names: readonly string[],
  native: EmailNativeOptionsMap | undefined,
) {
  if (!native) return;

  for (const name of names) {
    const entry = Object.hasOwn(native, name) ? native[name] : undefined;

    for (const key of RECIPIENT_REPLACING_NATIVE_KEYS) {
      if (entry?.[key] !== undefined) {
        throw new EmailValidationError(
          `sendPersonalized can't use native.${name}.${key}, because it can replace the recipients the result reports. Use send() for this message, or the adapter's typed native options.`,
        );
      }
    }
  }
}

export function personalizedMiddlewareMessage(input: EmailPersonalizedInput): EmailMessage {
  const to = input.recipients[0]?.to ?? "";

  // SAFETY: input.message is an EmailMessage template without recipients; adding `to` restores EmailMessage.
  return {
    ...input.message,
    to,
  } as EmailMessage;
}

export function withPersonalizedMessage(
  input: EmailPersonalizedInput,
  message: EmailMessage,
): EmailPersonalizedInput {
  const { to: _to, cc: _cc, bcc: _bcc, ...rest } = message;

  return {
    // SAFETY: Omitting to, cc, and bcc from a snapshotted EmailMessage restores the template shape.
    message: rest as EmailPersonalizedInput["message"],
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
    html:
      input.message.html === undefined
        ? undefined
        : (render(input.message.html) ?? input.message.html),
    text:
      input.message.text === undefined
        ? undefined
        : (render(input.message.text) ?? input.message.text),
  } as EmailMessage;
}

export function recipientIdempotencyKey(base: string | undefined, address: string) {
  return base ? `${base}:${address}` : undefined;
}

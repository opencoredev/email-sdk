import type { EmailMessage } from "@opencoredev/email-sdk";

import { freezeMessage, messageDigest } from "./policy.js";
import type { EmailMcpErrorCode } from "./types.js";

export type ValidationState =
  | "validated"
  | "approving"
  | "sending"
  | "sent"
  | "failed"
  | "outcome_unknown";

export type ValidationRecord = {
  reference: string;
  adapter: string;
  policyVersion: string;
  digest: string;
  message: EmailMessage;
  createdAt: number;
  expiresAt: number;
  state: ValidationState;
};

export type ValidationStoreResult =
  | { ok: true; record: ValidationRecord }
  | { ok: false; code: EmailMcpErrorCode };

export class ValidationStore {
  private readonly records = new Map<string, ValidationRecord>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  create(input: Omit<ValidationRecord, "digest" | "message" | "state"> & { message: EmailMessage }) {
    this.prune();

    if (this.records.size >= this.maxEntries || this.records.has(input.reference)) {
      return undefined;
    }

    const message = freezeMessage(input.message);
    const record: ValidationRecord = {
      ...input,
      message,
      digest: messageDigest(message),
      state: "validated",
    };
    this.records.set(record.reference, record);
    return record;
  }

  beginApproval(
    reference: string,
    adapter: string,
    currentPolicyVersion: string,
  ): ValidationStoreResult {
    const record = this.records.get(reference);

    if (!record) {
      return { ok: false, code: "reference_not_found" };
    }

    if (record.expiresAt <= this.now()) {
      this.records.delete(reference);
      return { ok: false, code: "reference_expired" };
    }

    if (record.state !== "validated") {
      return { ok: false, code: "reference_used" };
    }

    if (
      record.adapter !== adapter ||
      record.policyVersion !== currentPolicyVersion ||
      record.digest !== messageDigest(record.message)
    ) {
      record.state = "failed";
      return { ok: false, code: "reference_mismatch" };
    }

    record.state = "approving";
    return { ok: true, record };
  }

  beginSending(record: ValidationRecord): boolean {
    if (record.state !== "approving") {
      return false;
    }

    record.state = "sending";
    return true;
  }

  finish(record: ValidationRecord, state: Extract<ValidationState, "sent" | "failed" | "outcome_unknown">) {
    record.state = state;
  }

  private prune() {
    const now = this.now();

    for (const [reference, record] of this.records) {
      if (
        record.expiresAt <= now ||
        record.state === "sent" ||
        record.state === "failed" ||
        record.state === "outcome_unknown"
      ) {
        this.records.delete(reference);
      }
    }
  }
}

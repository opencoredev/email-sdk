import { describe, expect, test } from "bun:test";

import { ValidationStore } from "../src/store.js";

describe("ValidationStore", () => {
  test("binds immutable messages to adapter, policy, digest, and single-use state", () => {
    let now = 100;
    const store = new ValidationStore(2, () => now);
    const record = store.create({
      reference: "emv_1234567890123456",
      adapter: "resend",
      policyVersion: "policy-a",
      message: {
        from: "sender@example.com",
        to: "person@example.com",
        subject: "Subject",
        text: "Body",
      },
      createdAt: now,
      expiresAt: 200,
    });

    expect(record).toBeDefined();
    expect(() => {
      (record!.message as { subject: string }).subject = "Changed";
    }).toThrow();
    expect(store.beginApproval(record!.reference, "other", "policy-a")).toEqual({
      ok: false,
      code: "reference_mismatch",
    });
    expect(store.beginApproval(record!.reference, "resend", "policy-a")).toEqual({
      ok: false,
      code: "reference_used",
    });

    now = 201;
    expect(store.beginApproval("unknown", "resend", "policy-a")).toEqual({
      ok: false,
      code: "reference_not_found",
    });
  });

  test("does not overwrite an existing opaque reference", () => {
    const store = new ValidationStore(2, () => 100);
    const input = {
      reference: "emv_1234567890123456",
      adapter: "resend",
      policyVersion: "policy-a",
      message: {
        from: "sender@example.com",
        to: "person@example.com",
        subject: "Subject",
        text: "Body",
      },
      createdAt: 100,
      expiresAt: 200,
    } as const;

    expect(store.create(input)).toBeDefined();
    expect(store.create(input)).toBeUndefined();
  });

  test("bounds pending references and reclaims expired entries", () => {
    let now = 100;
    const store = new ValidationStore(1, () => now);
    const create = (reference: string, expiresAt: number) =>
      store.create({
        reference,
        adapter: "resend",
        policyVersion: "policy-a",
        message: {
          from: "sender@example.com",
          to: "person@example.com",
          subject: "Subject",
          text: "Body",
        },
        createdAt: now,
        expiresAt,
      });

    expect(create("emv_1234567890123456", 200)).toBeDefined();
    expect(create("emv_abcdefghijklmnop", 300)).toBeUndefined();

    now = 201;
    expect(create("emv_abcdefghijklmnop", 300)).toBeDefined();
  });
});

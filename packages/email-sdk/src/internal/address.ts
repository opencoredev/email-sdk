import type { EmailAddress } from "../types.js";
import { isStringMember } from "./decode.js";

type ScannedMailbox = {
  /** Text outside the angle-addr: a display name, or the whole mailbox when it has no `<...>`. */
  readonly outside: string;
  /** Text inside the first `<...>` that sits outside quotes and comments. */
  readonly angle: string | undefined;
};

/**
 * Splits a mailbox such as `"Ada <team>" <ada@example.test> (work)` around its angle-addr, with
 * each RFC 5322 comment replaced by a space so it still separates the tokens around it. Quoted
 * strings and comments may hold `<`, `>`, `(`, `)`, and `,`, so the scan steps over them instead
 * of matching brackets inside them. Returns undefined when a quote, comment, or angle-addr is
 * never closed, or when a comma outside them makes the string an address list.
 */
function scanMailbox(mailbox: string): ScannedMailbox | undefined {
  let outside = "";
  let angle: string | undefined;
  let inAngle = false;
  let quoted = false;
  let commentDepth = 0;

  for (let index = 0; index < mailbox.length; index += 1) {
    const character = mailbox.charAt(index);

    if (commentDepth > 0) {
      if (character === "\\") index += 1;
      else if (character === "(") commentDepth += 1;
      else if (character === ")") commentDepth -= 1;

      continue;
    }

    let kept = character;

    if (quoted) {
      if (character === "\\") {
        index += 1;
        kept += mailbox.charAt(index);
      } else if (character === '"') {
        quoted = false;
      }
    } else if (character === "(") {
      commentDepth = 1;
      kept = " ";
    } else if (character === ",") {
      return undefined;
    } else if (character === '"') {
      quoted = true;
    } else if (character === "<" && angle === undefined) {
      inAngle = true;
      angle = "";
      continue;
    } else if (character === ">" && inAngle) {
      inAngle = false;
      continue;
    }

    if (inAngle) angle += kept;
    else outside += kept;
  }

  if (quoted || inAngle || commentDepth > 0) return undefined;

  return { outside, angle };
}

/** The bare address of a mailbox such as `Ada <ada@example.test>`. Strings are trimmed; case is kept. */
export function mailboxAddress(address: EmailAddress): string {
  if (!isStringMember(address)) return address.email;

  const scanned = scanMailbox(address);

  if (!scanned) return address.trim();

  return (scanned.angle ?? scanned.outside).trim();
}

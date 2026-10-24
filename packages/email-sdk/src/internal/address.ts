import type { EmailAddress } from "../types.js";
import { isStringMember } from "./decode.js";

// The angle-addr that ends a mailbox. Only the last one counts: a quoted display name such as
// `"Ada <team>" <ada@example.test>` may contain brackets of its own.
const trailingAngleAddr = /<([^<>]+)>\s*$/;

/** The bare address of a mailbox such as `Ada <ada@example.test>`. Strings are trimmed; case is kept. */
export function mailboxAddress(address: EmailAddress): string {
  if (!isStringMember(address)) return address.email;

  const bracketed = trailingAngleAddr.exec(address);

  return (bracketed?.[1] ?? address).trim();
}

import { email } from "./email";

export async function sendPasswordReset(to: string, resetUrl: string) {
  return await email.send({
    from: "Acme <security@acme.com>",
    to,
    subject: "Reset your Acme password",
    text: `Reset your password: ${resetUrl}\nThe link expires in 30 minutes.`,
    tags: [{ name: "type", value: "password-reset" }],
  });
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send(
    {
      from: "Acme <billing@acme.com>",
      to,
      subject: `Your Acme receipt for order ${orderId}`,
      text: `Thanks for your order ${orderId}.`,
      metadata: { orderId },
    },
    { fallback: { adapters: [] } },
  );
}

import { email } from "./email";

export async function sendMagicLink(to: string, loginUrl: string) {
  return await email.send({
    from: "Acme <login@mg.acme.com>",
    to,
    subject: "Your Acme sign-in link",
    text: `Sign in to Acme: ${loginUrl}\nThe link expires in 15 minutes.`,
    tags: [{ name: "type", value: "magic-link" }],
  });
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send(
    {
      from: "Acme <billing@mg.acme.com>",
      to,
      subject: `Your Acme receipt for order ${orderId}`,
      text: `Thanks for your order ${orderId}.`,
      tags: [{ name: "order", value: orderId }],
    },
    { fallback: { adapters: [] } },
  );
}

import type { ReactElement } from "react";

export * from "./react-shadcn.js";

export type ReactEmailContent = {
  html: string;
  text: string;
};

export async function renderEmail(template: ReactElement): Promise<ReactEmailContent> {
  const { render, toPlainText } = await import("@react-email/render");
  const html = await render(template);

  return {
    html,
    text: toPlainText(html),
  };
}

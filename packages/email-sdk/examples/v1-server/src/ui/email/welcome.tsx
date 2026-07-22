import {
  EmailButton,
  EmailCard,
  EmailHeading,
  EmailSeparator,
  EmailText,
  ShadcnEmail,
} from "@opencoredev/email-sdk/react";

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <ShadcnEmail preview="Your account is ready.">
      <EmailCard>
        <EmailText muted>ACME</EmailText>
        <EmailHeading>Welcome, {name}</EmailHeading>
        <EmailText>Your account is ready. You can start using Acme now.</EmailText>
        <EmailButton href="https://acme.com/dashboard">Open dashboard</EmailButton>
        <EmailSeparator />
        <EmailText muted>If you did not create this account, you can ignore this email.</EmailText>
      </EmailCard>
    </ShadcnEmail>
  );
}

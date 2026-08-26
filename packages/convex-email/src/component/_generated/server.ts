import type {
  ActionBuilder,
  GenericActionCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericMutationCtx,
  GenericQueryCtx,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
} from "convex/server";
import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

import type { DataModel } from "./dataModel.js";

export type Env = {
  AWS_ACCESS_KEY_ID?: string;
  AWS_REGION?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  BREVO_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ITERABLE_API_KEY?: string;
  ITERABLE_CAMPAIGN_ID?: string;
  JETEMAIL_API_KEY?: string;
  LETTERMINT_API_TOKEN?: string;
  LETTERMINT_ROUTE?: string;
  LETTR_API_KEY?: string;
  LOOPS_API_KEY?: string;
  LOOPS_TRANSACTIONAL_ID?: string;
  MAILCHIMP_API_KEY?: string;
  MAILERSEND_API_KEY?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  MAILPACE_API_KEY?: string;
  MAILTRAP_API_KEY?: string;
  PLUNK_API_KEY?: string;
  POSTMARK_SERVER_TOKEN?: string;
  PRIMITIVE_API_KEY?: string;
  RESEND_API_KEY?: string;
  SCALEWAY_PROJECT_ID?: string;
  SCALEWAY_REGION?: string;
  SCALEWAY_SECRET_KEY?: string;
  SENDGRID_API_KEY?: string;
  SEQUENZY_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PASS?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SPARKPOST_API_KEY?: string;
  UNOSEND_API_KEY?: string;
  ZEPTOMAIL_TOKEN?: string;
};

export const env: Env = process.env as unknown as Env;

export const query: QueryBuilder<DataModel, "public"> = queryGeneric;
export const internalQuery: QueryBuilder<DataModel, "internal"> = internalQueryGeneric;
export const mutation: MutationBuilder<DataModel, "public"> = mutationGeneric;
export const internalMutation: MutationBuilder<DataModel, "internal"> = internalMutationGeneric;
export const action: ActionBuilder<DataModel, "public"> = actionGeneric;
export const internalAction: ActionBuilder<DataModel, "internal"> = internalActionGeneric;
export const httpAction: HttpActionBuilder = httpActionGeneric;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;

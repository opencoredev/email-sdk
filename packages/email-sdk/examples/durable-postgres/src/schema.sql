CREATE TABLE IF NOT EXISTS business_records (
  id text PRIMARY KEY,
  state text NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  business_key text NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  provider text NOT NULL,
  account text NOT NULL,
  message jsonb NOT NULL,
  recipients text[] NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','inflight','accepted','failed','suppressed','needs_reconciliation')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  next_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claim_token uuid,
  delivery text CHECK (delivery IN ('delivered','bounced','complained')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(next_at) WHERE state = 'queued';
CREATE TABLE IF NOT EXISTS attempts (
  job_id uuid NOT NULL REFERENCES jobs(id),
  number integer NOT NULL,
  token uuid NOT NULL UNIQUE,
  outcome text NOT NULL DEFAULT 'inflight',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (job_id, number)
);
CREATE TABLE IF NOT EXISTS receipts (
  provider text NOT NULL,
  account text NOT NULL,
  message_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id),
  PRIMARY KEY (provider, account, message_id)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  provider text NOT NULL,
  account text NOT NULL,
  delivery_id text NOT NULL,
  message_id text,
  status text CHECK (status IN ('delivered','bounced','complained')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, account, delivery_id)
);
CREATE TABLE IF NOT EXISTS suppressions (
  recipient text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reconciliations (
  job_id uuid NOT NULL REFERENCES jobs(id),
  decision text NOT NULL,
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

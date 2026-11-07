-- Phase 0: spike results and verified PayPal webhook events (PRD §C1, FR-SEC-7).
create table if not exists spike_runs (
  id bigserial primary key,
  step text not null,
  ok boolean not null,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id bigserial primary key,
  event_id text unique,
  event_type text not null,
  verified boolean not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

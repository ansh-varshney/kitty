-- Phase 1 additions: paw-up rounds, overruns, squad leftover setting.
alter table plan_members add column if not exists pawup_need_cents integer;
alter table plan_members add column if not exists overrun_due_cents integer not null default 0;
alter table plan_members add column if not exists overrun_paid boolean not null default false;
alter table plans add column if not exists pawup_until timestamptz;
alter table receipts add column if not exists extra_cents integer not null default 0;
alter table receipts add column if not exists leftover_cents integer not null default 0;
alter table squads add column if not exists leftovers_to_savings boolean not null default false;
alter table refunds add column if not exists capture_id text;

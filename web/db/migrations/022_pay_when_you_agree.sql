-- Agreeing and paying are one step (owner, 11 Nov 2026; FR-JAR-8). Floating a whim, saying yes to one, or asking to
-- tag along sets your share aside from your Treat Jar right then. It's given back if it doesn't go ahead.
create table if not exists whim_holds (
  whim_id uuid not null references whims(id),
  user_id uuid not null references users(id),
  jar_cents integer not null default 0,
  savings_cents integer not null default 0,
  status text not null default 'held' check (status in ('held', 'used', 'released')),
  created_at timestamptz not null default now(),
  primary key (whim_id, user_id)
);

alter table tag_requests add column if not exists held_jar integer not null default 0;
alter table tag_requests add column if not exists held_savings integer not null default 0;
alter table tag_requests drop constraint if exists tag_requests_status_check;
alter table tag_requests add constraint tag_requests_status_check check (status in ('asked', 'approved', 'declined', 'done', 'expired'));

-- A whim waiting for its floater's Treat Jar refill, floated the moment the money lands.
create table if not exists whim_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  body jsonb not null,
  created_at timestamptz not null default now()
);

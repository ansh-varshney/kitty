-- After the Pounce, tagging along needs the host's yes (owner, 10 Nov 2026; FR-POUNCE-14..17).
-- One row per person per plan: they get one ask, and a no stays a no.
create table if not exists tag_requests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  user_id uuid not null references users(id),
  status text not null default 'asked' check (status in ('asked', 'approved', 'declined', 'done')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists tag_requests_one_each on tag_requests(plan_id, user_id);
create index if not exists tag_requests_open on tag_requests(status, plan_id);

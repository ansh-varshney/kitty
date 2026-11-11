-- The whim is where things get decided; a plan only collects the money (owner, 10 Nov 2026; FR-WHIM-10, FR-NEG-9, FR-PLAN-9).

-- The host picks where the money comes from when floating: Kitty Party savings first, or the Treat Jar only.
alter table whims add column if not exists use_savings boolean not null default false;
alter table plans add column if not exists use_savings boolean not null default false;
-- How many times negotiation has changed this whim (it stops at 2).
alter table whims add column if not exists version integer not null default 0;

-- Answers are yes or no now. A kitten can suggest negotiating instead, and each person gets one try.
alter table answers add column if not exists negotiated boolean not null default false;
alter table answers drop constraint if exists answers_prepared_check;
alter table answers drop constraint if exists answers_confirmed_check;
update answers set prepared = 'negotiate' where prepared = 'maybe';
update answers set confirmed = null, confirmed_at = null where confirmed = 'maybe';
alter table answers add constraint answers_prepared_check check (prepared in ('yes', 'negotiate', 'no'));
alter table answers add constraint answers_confirmed_check check (confirmed in ('yes', 'no'));

create table if not exists whim_negotiations (
  id uuid primary key default gen_random_uuid(),
  whim_id uuid not null references whims(id),
  user_id uuid not null references users(id),
  status text not null default 'with_host' check (status in ('with_host', 'accepted', 'kept', 'closed')),
  proposal jsonb not null,
  created_at timestamptz not null default now()
);
-- One negotiation at a time per whim, so two kittens can't change it from under each other.
create unique index if not exists whim_negotiations_one_open on whim_negotiations (whim_id) where status = 'with_host';

-- The kitten-to-kitten conversation on a whim. Read-only for people.
create table if not exists whim_talk (
  id bigserial primary key,
  whim_id uuid not null references whims(id),
  from_user uuid not null references users(id),
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists whim_talk_by_whim on whim_talk (whim_id, id);

-- Only the host Pounces now.
update plans set pounce_rule = 'host' where status in ('open', 'on_ice');

-- Phase 2: Yarn, Nine Lives, Kitty Party, Catnip, The Bowl, purrs, Meows settings, export (PRD §B11–B21).

-- Secret gift groups are squads of their own kind (the birthday person is never a member).
alter table squads drop constraint if exists squads_kind_check;
alter table squads add constraint squads_kind_check check (kind in ('squad','mini','gift'));

-- Yarn: "I paid" cards and who owes what (§B11). IOUs, not money in Kitty, until someone settles.
create table if not exists yarn_cards (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id),
  payer_id uuid not null references users(id),
  created_by uuid not null references users(id),
  cents integer not null check (cents > 0),
  note text not null,
  kind text not null default 'split' check (kind in ('split','treat','loan')),
  status text not null default 'pending' check (status in ('pending','confirmed','disputed','void')),
  source_ref uuid,
  created_at timestamptz not null default now()
);
create table if not exists yarn_parts (
  card_id uuid not null references yarn_cards(id) on delete cascade,
  user_id uuid not null references users(id),
  cents integer not null check (cents >= 0),          -- what this person owes the payer (0 for a treat)
  status text not null default 'pending' check (status in ('pending','confirmed','disputed')),
  primary key (card_id, user_id)
);
create table if not exists yarn_settlements (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id),
  untangle_id uuid not null,
  from_user uuid not null references users(id),
  to_user uuid not null references users(id),
  cents integer not null check (cents > 0),
  status text not null default 'open' check (status in ('open','paid','void')),
  paid_via text,
  paypal_id text,
  payout_batch_id text,
  reminded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Nine Lives: private help requests (§B12)
create table if not exists help_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users(id),
  cents integer not null check (cents > 0),
  note text not null,
  kind text not null default 'either' check (kind in ('gift','loan','either')),
  needed_by date,
  status text not null default 'open' check (status in ('open','filled','closed')),
  received_cents integer,
  payout_batch_id text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table if not exists help_asks (
  request_id uuid not null references help_requests(id),
  user_id uuid not null references users(id),
  suggested_cents integer not null default 0,
  status text not null default 'asked' check (status in ('asked','pledged','declined')),
  primary key (request_id, user_id)
);
create table if not exists help_pledges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references help_requests(id),
  user_id uuid not null references users(id),
  cents integer not null check (cents > 0),
  as_loan boolean not null default false,
  source text not null check (source in ('jar','paypal')),
  order_id text,
  authorization_id text,
  approve_url text,
  capture_id text,
  status text not null default 'held' check (status in ('pending','held','captured','voided')),
  created_at timestamptz not null default now()
);

-- Kitty Party: one per squad; each member saves their own monthly amount (§B13)
create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null unique references squads(id),
  name text not null,
  goal_cents integer,
  goal_note text,
  interval_unit text not null default 'MONTH' check (interval_unit in ('DAY','WEEK','MONTH')),
  paypal_product_id text,
  paypal_plan_id text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table if not exists party_members (
  party_id uuid not null references parties(id),
  user_id uuid not null references users(id),
  monthly_cents integer not null check (monthly_cents > 0),
  subscription_id text,
  approve_url text,
  status text not null default 'pending' check (status in ('pending','active','stopped')),
  collected_count integer not null default 0,
  last_collected_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

-- Catnip: secret group gifts (§B14)
create table if not exists gift_groups (
  id uuid primary key default gen_random_uuid(),
  birthday_user uuid not null references users(id),
  origin_squad uuid not null references squads(id),
  squad_id uuid references squads(id),
  birthday date not null,
  status text not null default 'radar' check (status in ('radar','open','deleted')),
  plan_id uuid references plans(id),
  delete_after timestamptz not null,
  created_at timestamptz not null default now(),
  unique (birthday_user, origin_squad, birthday)
);
create table if not exists gift_members (
  group_id uuid not null references gift_groups(id) on delete cascade,
  user_id uuid not null references users(id),
  status text not null default 'invited' check (status in ('invited','joined','skipped')),
  limit_cents integer,
  primary key (group_id, user_id)
);
create table if not exists gift_ideas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references gift_groups(id) on delete cascade,
  title text not null,
  price_cents integer,
  url text,
  image_url text,
  brand text,
  source text not null check (source in ('channel3','ai','member')),
  added_by uuid references users(id),
  votes uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- The Bowl: shared subscriptions (§B15)
create table if not exists bowls (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id),
  owner_id uuid not null references users(id),
  service text not null,
  total_cents integer not null check (total_cents > 0),
  seats integer not null check (seats >= 2),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);
create table if not exists bowl_members (
  bowl_id uuid not null references bowls(id),
  user_id uuid not null references users(id),
  share_cents integer not null,
  status text not null default 'pending' check (status in ('pending','active','left')),
  subscription_id text,
  approve_url text,
  last_paid_at timestamptz,
  primary key (bowl_id, user_id)
);
create table if not exists bowl_cycles (
  id uuid primary key default gen_random_uuid(),
  bowl_id uuid not null references bowls(id),
  collected_cents integer not null,
  missed integer not null default 0,
  payout_batch_id text,
  created_at timestamptz not null default now()
);

-- Purrs, collar tags, Top Cat (§B17)
create table if not exists purrs (
  id bigserial primary key,
  user_id uuid not null references users(id),
  squad_id uuid references squads(id),
  points integer not null,
  reason text not null,
  event_id bigint,
  created_at timestamptz not null default now(),
  unique (user_id, event_id, reason)
);
create table if not exists collar_tags (
  user_id uuid not null references users(id),
  tag text not null,
  private boolean not null default false,
  earned_at timestamptz not null default now(),
  primary key (user_id, tag)
);
create table if not exists job_state (
  name text primary key,
  cursor bigint not null default 0,
  ran_at timestamptz
);

-- Meows time, quiet hours, private calendar feed (§B16, §B21)
alter table users add column if not exists meow_time text not null default '09:00';
-- Phase 1 stored quiet hours as whole hours (smallint 22 / 8); Meows and alerts use "HH:MM".
alter table users alter column quiet_start drop default;
alter table users alter column quiet_start type text using lpad(quiet_start::text, 2, '0') || ':00';
alter table users alter column quiet_start set default '22:00';
alter table users alter column quiet_end drop default;
alter table users alter column quiet_end type text using lpad(quiet_end::text, 2, '0') || ':00';
alter table users alter column quiet_end set default '08:00';
alter table users add column if not exists calendar_token text unique;

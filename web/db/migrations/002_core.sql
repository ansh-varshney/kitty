-- Phase 1: backend core (PRD §B1–B10, §B19, §B20 checks; design in §D8 "Phase 1 detail pass").
-- Money is integer cents everywhere.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  paypal_payer_id text unique,
  paypal_email text,
  email_verified boolean not null default false,
  name text not null,
  gender text,
  birth_date date,
  share_birthday boolean not null default true,
  interests text[] not null default '{}',
  timezone text not null default 'America/Los_Angeles',
  quiet_start smallint not null default 22,
  quiet_end smallint not null default 8,
  availability jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists kittens (
  user_id uuid primary key references users(id) on delete cascade,
  name text not null,
  look jsonb not null default '{}'::jsonb,
  breed text not null default 'tabby',
  memory jsonb not null default '[]'::jsonb
);

create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'squad' check (kind in ('squad','mini')),
  created_by uuid references users(id),
  invite_code text unique,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  squad_id uuid not null references squads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (squad_id, user_id)
);

create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  squad_id uuid references squads(id) on delete cascade,
  type text not null,               -- R1..R7 or 'personal'
  params jsonb not null default '{}'::jsonb,
  text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rules_user on rules(user_id);

create table if not exists whims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  squad_id uuid not null references squads(id),
  what text not null,
  when_text text,
  starts_at timestamptz,
  ends_at timestamptz,
  up_to_cents integer,
  place text,
  price_cents integer,
  image_url text,
  source_url text,
  need_at_least integer not null default 2,
  anonymous boolean not null default true,
  status text not null default 'floating' check (status in ('floating','plan','faded')),
  expires_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  whim_id uuid references whims(id) on delete cascade,
  plan_id uuid,
  user_id uuid not null references users(id),
  prepared text check (prepared in ('yes','maybe','no')),
  prepared_reason text,
  facts jsonb not null default '{}'::jsonb,
  confirmed text check (confirmed in ('yes','maybe','no')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (whim_id, user_id)
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  whim_id uuid references whims(id),
  squad_id uuid not null references squads(id),
  host_id uuid not null references users(id),
  booker_id uuid not null references users(id),
  title text not null,
  image_url text,
  place text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_mode text not null default 'total' check (price_mode in ('total','per_person')),
  price_cents integer not null,
  split_mode text not null default 'equal' check (split_mode in ('equal','custom','weights')),
  need_at_least integer not null default 2,
  pounce_rule text not null default 'everyone' check (pounce_rule in ('everyone','at_least','host')),
  decide_by timestamptz not null,
  refund_until timestamptz,
  status text not null default 'open' check (status in ('open','pouncing','pounced','settled','on_ice','cancelled')),
  locked_at timestamptz,
  paw_up_round integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists plan_members (
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references users(id),
  status text not null default 'invited' check (status in ('invited','thinking','in','out')),
  limit_cents integer,              -- private: only the referee reads it
  weight integer not null default 1,
  custom_cents integer,
  use_savings boolean not null default true,
  joined_at timestamptz,
  primary key (plan_id, user_id)
);

create table if not exists paws (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references users(id),
  kind text not null check (kind in ('initial','paw_up','cover','tag_along')),
  source text not null check (source in ('savings','jar','paypal')),
  cents integer not null check (cents > 0),
  cover_for uuid references users(id),
  order_id text,
  authorization_id text,
  approve_url text,
  status text not null default 'pending' check (status in ('pending','held','captured','voided','failed')),
  captured_cents integer not null default 0,
  capture_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists paws_plan on paws(plan_id);

create table if not exists pounces (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  group_ids uuid[] not null,
  shares jsonb not null,
  total_cents integer not null,
  payout_batch_id text,
  status text not null default 'done',
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  user_id uuid not null references users(id),
  cents integer not null,
  source text not null,
  paypal_refund_id text,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  booker_id uuid not null references users(id),
  extracted_cents integer,
  confirmed_cents integer,
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_at timestamptz not null default now()
);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  from_user uuid references users(id),
  round integer not null,
  candidate jsonb not null,
  status text not null default 'open' check (status in ('open','chosen','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,
  created_at timestamptz not null default now()
);

create table if not exists ledger (
  id bigserial primary key,
  txn uuid not null,
  account text not null,
  amount_cents integer not null,
  kind text not null,
  user_id uuid,
  plan_id uuid,
  reason text,
  paypal_id text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_account on ledger(account);
create index if not exists ledger_plan on ledger(plan_id);

create table if not exists events (
  id bigserial primary key,
  squad_id uuid,
  user_id uuid,                     -- owner (Kitten Diary); null = squad-wide only
  actor text not null,              -- 'user' | 'kitten' | 'system'
  actor_id uuid,
  type text not null,
  object_type text,
  object_id uuid,
  payload jsonb not null default '{}'::jsonb,    -- visible to user_id only
  public jsonb,                                  -- squad-visible, private data masked
  reason text,
  paypal_id text,
  created_at timestamptz not null default now()
);
create index if not exists events_squad on events(squad_id, id);
create index if not exists events_user on events(user_id, id);

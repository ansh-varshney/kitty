-- Kittens do the chasing (PRD §B11, FR-REMIND-1..6).

-- One row per reminder sent. The unique key means a timer running twice can't send the same one twice.
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('yarn_pay','card_confirm','plan_paw','receipt','owed_note')),
  object_id uuid not null,
  user_id uuid not null references users(id),
  round integer not null check (round >= 1),
  text text not null,
  from_user uuid references users(id),
  sent_at timestamptz not null default now(),
  unique (kind, object_id, user_id, round)
);
create index if not exists reminders_user on reminders (user_id, kind, object_id);

-- A reminder the earlier one-off job already sent counts as the first round.
insert into reminders (kind, object_id, user_id, round, text, from_user, sent_at)
  select 'yarn_pay', id, from_user, 1, '', to_user, reminded_at from yarn_settlements where reminded_at is not null
  on conflict do nothing;

-- A Kitty Party payment PayPal couldn't take; cleared by the next payment that works.
alter table party_members add column if not exists payment_failed_at timestamptz;

-- When a card was last covered by an Untangle. Empty = the weekly Untangle still has to pick it up.
alter table yarn_cards add column if not exists untangled_at timestamptz;
update yarn_cards c set untangled_at = x.latest
  from (select squad_id, max(created_at) as latest from yarn_settlements where status <> 'void' group by squad_id) x
  where x.squad_id = c.squad_id and c.status = 'confirmed' and c.created_at <= x.latest;

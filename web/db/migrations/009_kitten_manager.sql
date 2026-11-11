-- The kitten runs everything (PRD §B11, §B16, §B18, owner's change 9 Nov).

-- "I paid" cards are worked out between the two kittens: whose turn it is, what's on the table, and how it got there.
alter table yarn_parts drop constraint if exists yarn_parts_status_check;
alter table yarn_parts add constraint yarn_parts_status_check check (status in ('pending','confirmed','disputed','countered'));
alter table yarn_parts add column if not exists waiting_on uuid references users(id);
alter table yarn_parts add column if not exists proposed_cents integer check (proposed_cents >= 0);
alter table yarn_parts add column if not exists round integer not null default 1;
alter table yarn_parts add column if not exists offers jsonb not null default '[]';
update yarn_parts set waiting_on = user_id where status = 'pending' and waiting_on is null;
-- Cards already marked "not right" go to the other side, so they aren't stuck with nobody's turn.
update yarn_parts p set waiting_on = case when p.user_id = c.payer_id then c.created_by else c.payer_id end
  from yarn_cards c where c.id = p.card_id and p.status = 'disputed' and p.waiting_on is null and c.status <> 'void';

-- A payment that settles one card says which card and what for.
alter table yarn_settlements add column if not exists card_id uuid references yarn_cards(id);
alter table yarn_settlements add column if not exists note text;

-- Everything that needs you lands in your kitten's chat first. Meows shows the same cards.
create table if not exists kitten_cards (
  id bigserial primary key,
  user_id uuid not null references users(id),
  key text not null,
  text text not null,
  card jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  done_at timestamptz,
  unique (user_id, key)
);
create index if not exists kitten_cards_open on kitten_cards (user_id) where done_at is null;

alter table kittens add column if not exists chat_seen_at timestamptz default now();
update kittens set chat_seen_at = now() where chat_seen_at is null;

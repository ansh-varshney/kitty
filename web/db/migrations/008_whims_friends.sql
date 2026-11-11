-- A whim carries everything its plan needs, set when it's floated (PRD §B6, owner's change 9 Nov).
alter table whims add column if not exists price_mode text check (price_mode in ('total','per_person'));
alter table whims add column if not exists pounce_rule text check (pounce_rule in ('everyone','at_least','host'));
alter table whims add column if not exists decide_by timestamptz;
alter table whims add column if not exists booker_id uuid references users(id);

-- One-to-one chats: you, your kitten, a friend and their kitten (PRD §B18, FR-CHAT-8..10).
create table if not exists direct_messages (
  id bigserial primary key,
  from_user uuid not null references users(id),
  to_user uuid not null references users(id),
  from_kind text not null default 'person' check (from_kind in ('person','kitten')),
  to_kind text not null default 'person' check (to_kind in ('person','kitten')),
  text text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists direct_messages_pair on direct_messages (from_user, to_user, id desc);
create index if not exists direct_messages_unread on direct_messages (to_user) where read_at is null;

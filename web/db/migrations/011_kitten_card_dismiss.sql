-- "Not now" on a kitten's card: it stays closed until something about it changes (PRD §B18, FR-CHAT-12).
alter table kitten_cards add column if not exists dismissed_at timestamptz;

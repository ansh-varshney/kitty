-- The Bowl works like Kitty Party now: each person's share moves from their Treat Jar on a day they pick (owner, 10 Nov 2026; FR-BOWL-2).
alter table bowl_members add column if not exists pay_day integer check (pay_day between 1 and 28);
alter table bowl_members add column if not exists next_pay_at timestamptz;
alter table bowl_members add column if not exists payment_failed_at timestamptz;
alter table bowl_members add column if not exists collected_count integer not null default 0;
-- Anyone already in picks their day when they confirm.
update bowl_members set status = 'pending' where status = 'active';

-- A whim nobody has answered gets nudged too (FR-REMIND-1).
alter table reminders drop constraint if exists reminders_kind_check;
alter table reminders add constraint reminders_kind_check check (kind in ('yarn_pay', 'card_confirm', 'plan_paw', 'receipt', 'owed_note', 'whim_answer'));

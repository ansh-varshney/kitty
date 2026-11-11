-- Kitty Party savings now come from the Treat Jar on a day each person picks (owner, 9 Nov 2026; FR-PARTY-7).
-- save_day is 1 to 28, so the day exists in every month. next_save_at is when the next saving is due.
alter table party_members add column if not exists save_day integer check (save_day between 1 and 28);
alter table party_members add column if not exists next_save_at timestamptz;

-- Savings used to be a PayPal subscription, with no day chosen. Anyone already saving picks a day and starts again.
update party_members set status = 'stopped', approve_url = null where status in ('active', 'pending');
update rules set active = false where type = 'R6';

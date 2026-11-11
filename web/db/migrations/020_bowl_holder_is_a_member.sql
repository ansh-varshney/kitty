-- The account holder is a member of their own Bowl, with a share and a day, like everyone in a Kitty Party (owner, 10 Nov 2026; FR-BOWL-1, FR-BOWL-5).
-- Bowls already running get the holder's row as pending, so the kitten asks them to pick their day.
insert into bowl_members (bowl_id, user_id, share_cents, status)
select b.id, b.owner_id,
       least(
         greatest(b.total_cents - coalesce((select sum(m.share_cents) from bowl_members m where m.bowl_id = b.id and m.status <> 'left'), 0), 0),
         ceil(b.total_cents::numeric / b.seats)::int
       ),
       'pending'
from bowls b
where b.status = 'active'
on conflict (bowl_id, user_id) do nothing;

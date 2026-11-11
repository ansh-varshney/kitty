-- The host is always in (owner, 9 Nov 2026; FR-PLAN-8). Plans still running get their host back in.
-- Finished plans keep what really happened: if a host didn't go, they weren't charged.
update plan_members m
   set status = 'in', joined_at = coalesce(m.joined_at, now())
  from plans p
 where p.id = m.plan_id and p.host_id = m.user_id and p.status in ('open', 'on_ice') and m.status <> 'in';

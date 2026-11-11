-- A whim to one friend lives in that friend's chat (owner, 9 Nov). Plans still need somewhere to belong, so each pair of
-- friends has one private record behind the scenes. It's never listed as a squad.
alter table squads drop constraint if exists squads_kind_check;
alter table squads add constraint squads_kind_check check (kind in ('squad','mini','gift','direct'));

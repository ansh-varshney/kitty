-- A squad accidentally created by typing an invite code into the name box: its people join the real squad instead.
insert into memberships (squad_id, user_id)
  select r.id, m.user_id from squads stray join squads r on r.invite_code = stray.name and r.id <> stray.id join memberships m on m.squad_id = stray.id and m.left_at is null
  where stray.archived_at is null and r.archived_at is null
  on conflict (squad_id, user_id) do update set left_at = null;

insert into events (squad_id, actor, actor_id, type, payload, public)
  select r.id, 'user', m.user_id, 'squad.joined', '{}'::jsonb, jsonb_build_object('userId', m.user_id::text)
  from squads stray join squads r on r.invite_code = stray.name and r.id <> stray.id join memberships m on m.squad_id = stray.id and m.left_at is null
  where stray.archived_at is null and r.archived_at is null;

update memberships set left_at = now() where left_at is null and squad_id in (
  select stray.id from squads stray join squads r on r.invite_code = stray.name and r.id <> stray.id where stray.archived_at is null and r.archived_at is null
);

update squads set archived_at = now() where archived_at is null and id in (
  select stray.id from squads stray join squads r on r.invite_code = stray.name and r.id <> stray.id where r.archived_at is null
);

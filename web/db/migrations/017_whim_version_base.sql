-- whims.version already existed (default 1) before 016, so 016's "default 0" did nothing and every new whim looked already changed.
-- A whim's version now counts its changes: 0 means never changed (FR-NEG-5).
alter table whims alter column version set default 0;
update whims set version = greatest(version - 1, 0);

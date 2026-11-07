-- Each user's time zone, so "Friday 7pm" means 7pm where they are (Phase 1 finding). Default: US Pacific.
alter table users add column if not exists tz text not null default 'America/Los_Angeles';

-- Edge-case pass (8 Nov): a floater can withdraw a whim before it becomes a plan.
alter table whims drop constraint if exists whims_status_check;
alter table whims add constraint whims_status_check check (status in ('floating','plan','faded','withdrawn'));

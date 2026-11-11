-- The booker can say they paid for the booking another way (a website checkout, a card machine). Then it counts as paid,
-- and the next step is the receipt (owner, 11 Nov 2026; FR-POUNCE-13).
alter table plans add column if not exists booked_elsewhere_at timestamptz;

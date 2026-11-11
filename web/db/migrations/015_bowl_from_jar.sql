-- Every payment comes from the Treat Jar (owner, 10 Nov 2026; FR-JAR-7), so Bowl shares aren't PayPal subscriptions any more.
-- Anyone on an old subscription, or part-way through approving one, taps Join again; that also cancels the old subscription.
update bowl_members set status = 'pending', approve_url = null where status <> 'left' and (subscription_id is not null or approve_url is not null);

-- Required so the KDS client can distinguish the exact online-payment transition
-- to paid from later order status updates and avoid duplicate audio alerts.
alter table public.orders replica identity full;

-- Phase 1 — realtime KDS/order queue
-- Publish order changes so authenticated staff can receive Postgres Changes.
-- Row visibility remains enforced by the existing orders RLS policies.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end
$$;

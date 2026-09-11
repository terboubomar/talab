-- TALAB wallet identity hardening.
-- Stored-value wallet access must resolve one authenticated customer per tenant.
create unique index if not exists customers_tenant_user_uidx
  on public.customers(tenant_id,user_id)
  where user_id is not null;

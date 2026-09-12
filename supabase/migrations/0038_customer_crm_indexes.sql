-- TALAB CRM 360 supporting index.
-- The observed source tenant has tens of thousands of customers, so customer order
-- history/aggregate lookups need tenant+customer locality instead of repeated heap scans.

create index if not exists orders_tenant_customer_created_idx
  on public.orders (tenant_id, customer_id, created_at desc)
  include (status, total, branch_id);

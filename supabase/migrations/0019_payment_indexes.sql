-- Cover payment-related foreign keys used by joins, deletes, admin views, and webhook lookups.
create index if not exists payment_accounts_brand_id_idx
  on public.payment_accounts(brand_id)
  where brand_id is not null;

create index if not exists orders_payment_account_id_idx
  on public.orders(payment_account_id)
  where payment_account_id is not null;

create index if not exists payment_transactions_brand_id_idx
  on public.payment_transactions(brand_id);

create index if not exists payment_transactions_branch_id_idx
  on public.payment_transactions(branch_id);

create index if not exists payment_transactions_payment_account_id_idx
  on public.payment_transactions(payment_account_id)
  where payment_account_id is not null;

create index if not exists payment_webhook_events_tenant_id_idx
  on public.payment_webhook_events(tenant_id);

create index if not exists payment_webhook_events_transaction_id_idx
  on public.payment_webhook_events(transaction_id)
  where transaction_id is not null;

create index if not exists order_refunds_payment_transaction_id_idx
  on public.order_refunds(payment_transaction_id)
  where payment_transaction_id is not null;

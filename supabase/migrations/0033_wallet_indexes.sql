-- Cover wallet foreign keys identified by Supabase performance advisor.
create index if not exists wallets_customer_id_idx on public.wallets(customer_id);
create index if not exists wallet_ledger_actor_staff_id_idx on public.wallet_ledger(actor_staff_id);

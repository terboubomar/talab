-- TALAB Phase 2 — record point expiry as immutable ledger debits.

create or replace function app.points_expire_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_lot record;
  v_amount numeric;
  v_balance numeric;
  v_existing uuid;
begin
  for v_lot in
    select l.id,l.tenant_id,l.customer_id,l.remaining_points
    from public.points_lots l
    where l.customer_id=p_customer_id
      and l.remaining_points>0
      and l.expires_at is not null
      and l.expires_at<=now()
    order by l.expires_at asc,l.created_at asc,l.id asc
    for update
  loop
    select id into v_existing
    from public.points_ledger
    where tenant_id=v_lot.tenant_id
      and idempotency_key='points_lot:'||v_lot.id::text||':expiry';

    if v_existing is null then
      v_amount:=v_lot.remaining_points;
      update public.points_lots set remaining_points=0 where id=v_lot.id;

      select coalesce(sum(remaining_points),0) into v_balance
      from public.points_lots
      where customer_id=p_customer_id
        and remaining_points>0
        and (expires_at is null or expires_at>now());

      insert into public.points_ledger(
        tenant_id,customer_id,delta,balance_after,reason,ref_type,ref_id,idempotency_key,metadata
      ) values (
        v_lot.tenant_id,v_lot.customer_id,-v_amount,round(v_balance,2),
        'points expired','expiry',v_lot.id::text,'points_lot:'||v_lot.id::text||':expiry',
        jsonb_build_object('lot_id',v_lot.id)
      );
    else
      update public.points_lots set remaining_points=0 where id=v_lot.id;
    end if;
  end loop;
end;
$$;

create or replace function app.points_available(p_customer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, app
as $$
declare v_balance numeric;
begin
  perform app.points_cleanup_customer(p_customer_id);
  perform app.points_expire_customer(p_customer_id);
  select coalesce(sum(remaining_points),0) into v_balance
  from public.points_lots
  where customer_id=p_customer_id
    and remaining_points>0
    and (expires_at is null or expires_at>now());
  return round(coalesce(v_balance,0),2);
end;
$$;

revoke execute on function app.points_expire_customer(uuid) from public,anon,authenticated;
revoke execute on function app.points_available(uuid) from public,anon,authenticated;

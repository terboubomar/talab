-- TALAB Phase 2 — coupon auto-apply.
-- Reuses the already-verified explicit coupon quote engine so pricing, scopes,
-- limits, day-parting, delivery fees and reservation semantics stay single-source.

create or replace function public.storefront_coupon_auto_quote(
  p_branch_id uuid,
  p_order_type public.order_type,
  p_customer_phone text,
  p_items jsonb,
  p_cart_id uuid,
  p_area_id uuid default null,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant_id uuid;
  v_coupon record;
  v_quote jsonb;
  v_best_quote jsonb;
  v_best_code text;
  v_best_benefit numeric := -1;
  v_best_total numeric := null;
  v_benefit numeric;
  v_total numeric;
  v_temp_cart uuid;
  v_temp_reservation uuid;
begin
  if p_cart_id is null then
    raise exception 'cart_id_required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  select b.tenant_id into v_tenant_id
  from public.branches b
  where b.id = p_branch_id and b.status = 'active';

  if v_tenant_id is null then
    raise exception 'invalid_branch';
  end if;

  -- Evaluate each enabled auto-apply coupon through the same explicit quote RPC.
  -- Candidate reservations use throwaway cart ids and are deleted immediately,
  -- so only the final winning coupon reserves capacity for the customer's cart.
  for v_coupon in
    select c.id, c.code, c.created_at
    from public.coupons c
    where c.tenant_id = v_tenant_id
      and c.auto_apply
      and c.status = 'active'
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at is null or c.ends_at >= now())
      and app.coupon_daypart_allows(c.day_parting_json, now())
    order by c.created_at asc, c.id asc
  loop
    v_temp_cart := gen_random_uuid();
    v_quote := null;

    begin
      v_quote := public.storefront_coupon_quote(
        p_branch_id,
        p_order_type,
        p_customer_phone,
        v_coupon.code,
        p_items,
        v_temp_cart,
        p_area_id,
        p_source
      );
    exception
      when others then
        -- Ineligible coupons are expected here (scope/minimum/limits/etc.).
        -- Auto-apply skips them; the explicit-code path still surfaces its error.
        v_quote := null;
    end;

    if v_quote is not null then
      v_temp_reservation := nullif(v_quote->>'reservation_id','')::uuid;
      v_benefit := coalesce((v_quote->>'discount')::numeric, 0)
                 + coalesce((v_quote->>'delivery_discount')::numeric, 0);
      v_total := coalesce((v_quote->>'total')::numeric, 999999999::numeric);

      if v_temp_reservation is not null then
        delete from public.coupon_reservations
        where id = v_temp_reservation
          and cart_id = v_temp_cart
          and order_id is null
          and status = 'reserved';
      end if;

      -- Customer-first ranking: greatest monetary benefit. Ties choose the lower
      -- final total, then oldest coupon for deterministic results.
      if v_benefit > v_best_benefit
         or (v_benefit = v_best_benefit and (v_best_total is null or v_total < v_best_total)) then
        v_best_benefit := v_benefit;
        v_best_total := v_total;
        v_best_code := v_coupon.code;
        v_best_quote := v_quote;
      end if;
    end if;
  end loop;

  -- Calling auto-apply means the customer is not currently forcing an explicit
  -- code. Clear any old un-attached reservation on this cart before finalizing.
  update public.coupon_reservations
  set status = 'released', updated_at = now()
  where cart_id = p_cart_id
    and order_id is null
    and status = 'reserved';

  if v_best_code is null then
    return null;
  end if;

  -- Re-run the winner against the real cart id. This is intentionally a second
  -- validation so concurrent usage-limit changes cannot sneak an invalid coupon
  -- into checkout after candidate evaluation.
  v_best_quote := public.storefront_coupon_quote(
    p_branch_id,
    p_order_type,
    p_customer_phone,
    v_best_code,
    p_items,
    p_cart_id,
    p_area_id,
    p_source
  );

  return v_best_quote || jsonb_build_object('auto_applied', true);
end;
$$;

revoke execute on function public.storefront_coupon_auto_quote(
  uuid, public.order_type, text, jsonb, uuid, uuid, text
) from public;
grant execute on function public.storefront_coupon_auto_quote(
  uuid, public.order_type, text, jsonb, uuid, uuid, text
) to anon, authenticated;

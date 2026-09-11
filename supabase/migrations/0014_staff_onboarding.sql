-- Phase 1 — staff onboarding hardening + atomic branch-scoped invites

create or replace function public.admin_invite_staff_v2(
  p_name text,
  p_email text,
  p_role_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_staff_id uuid;
  v_branch_scoped boolean;
  v_branch_count integer;
begin
  v_tenant_id := app.current_tenant_id();

  if v_tenant_id is null then
    raise exception 'not_authorized';
  end if;

  if not (app.has_perm('staff.create') or app.is_platform_admin()) then
    raise exception 'not_authorized';
  end if;

  if p_name is null or length(trim(p_name)) = 0
     or p_email is null or length(trim(p_email)) = 0 then
    raise exception 'missing_fields';
  end if;

  select branch_scoped
    into v_branch_scoped
    from public.roles
   where id = p_role_id
     and tenant_id = v_tenant_id;

  if v_branch_scoped is null then
    raise exception 'invalid_role';
  end if;

  if exists (
    select 1
      from public.staff
     where tenant_id = v_tenant_id
       and email = lower(trim(p_email))
  ) then
    raise exception 'email_already_invited';
  end if;

  if v_branch_scoped and coalesce(array_length(p_branch_ids, 1), 0) = 0 then
    raise exception 'branch_required';
  end if;

  if coalesce(array_length(p_branch_ids, 1), 0) > 0 then
    select count(*)
      into v_branch_count
      from public.branches
     where tenant_id = v_tenant_id
       and id = any(p_branch_ids);

    if v_branch_count <> coalesce(array_length(p_branch_ids, 1), 0) then
      raise exception 'invalid_branch';
    end if;
  end if;

  insert into public.staff (tenant_id, name, email, status)
  values (v_tenant_id, trim(p_name), lower(trim(p_email)), 'active')
  returning id into v_staff_id;

  insert into public.staff_roles (tenant_id, staff_id, role_id)
  values (v_tenant_id, v_staff_id, p_role_id);

  if v_branch_scoped then
    insert into public.staff_branches (tenant_id, staff_id, branch_id)
    select v_tenant_id, v_staff_id, branch_id
      from unnest(p_branch_ids) as branch_id;
  end if;

  return v_staff_id;
end;
$$;

-- Staff/admin RPCs are authenticated-only. Storefront RPC grants are intentionally unchanged.
revoke execute on function public.admin_invite_staff(text, text, uuid) from public, anon;
grant execute on function public.admin_invite_staff(text, text, uuid) to authenticated;

revoke execute on function public.admin_invite_staff_v2(text, text, uuid, uuid[]) from public, anon;
grant execute on function public.admin_invite_staff_v2(text, text, uuid, uuid[]) to authenticated;

revoke execute on function public.staff_claim_invite() from public, anon;
grant execute on function public.staff_claim_invite() to authenticated;

revoke execute on function public.staff_my_permissions() from public, anon;
grant execute on function public.staff_my_permissions() to authenticated;

revoke execute on function public.staff_update_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.staff_update_order_status(uuid, public.order_status) to authenticated;

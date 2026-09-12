-- Align call-center order audit write with the current activity_log schema.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.staff_create_call_center_order(uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text)'::regprocedure
  ) into v_def;
  v_def := replace(v_def, 'diff_json', 'diff');
  execute v_def;
end $$;

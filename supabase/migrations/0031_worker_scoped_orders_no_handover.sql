-- Each worker (owner included) only sees and acts on orders they created.
-- No handover between workers: a worker must complete or cancel their own
-- active orders before closing their shift; day close (manual or the 01:00
-- auto-close) still cleans up whatever is left.
--
-- The existing functions are patched in place (regexp on their current
-- definition) so unrelated logic is untouched. Each patch must apply or the
-- whole migration aborts.
do $mig$
declare
  d text;
  d2 text;
  r record;
begin
  for r in
    select * from (values
      ('public.get_pos_active_orders(text)',
        'order by o\.created_at desc;',
        'and o.created_by_worker_id = v_context.worker_id order by o.created_at desc;', ''),

      ('public.update_pos_order_status(text,uuid,text,text)',
        'and o\.branch_id = v_context\.branch_id(\s+)for update;',
        'and o.branch_id = v_context.branch_id and o.created_by_worker_id = v_context.worker_id\1for update;', ''),

      ('public.record_order_payment(text,uuid,text,numeric,text)',
        'and o\.branch_id = v_context\.branch_id(\s+)for update;',
        'and o.branch_id = v_context.branch_id and o.created_by_worker_id = v_context.worker_id\1for update;', ''),

      ('public.get_order_payment_summary(text,uuid)',
        'and o\.branch_id = v_session\.branch_id',
        'and o.branch_id = v_session.branch_id and o.created_by_worker_id = v_session.worker_id', ''),

      ('public.get_pos_order_receipt(text,uuid)',
        'and o\.branch_id = v_context\.branch_id;',
        'and o.branch_id = v_context.branch_id and o.created_by_worker_id = v_context.worker_id;', ''),

      ('public.close_worker_shift(text,numeric,text,text)',
        'if v_other_open_shifts = 0 then',
        'if true then', ''),
      ('public.close_worker_shift(text,numeric,text,text)',
        '(from public\.orders as o\s+where o\.branch_id = v_context\.branch_id\s+and o\.status not in \(''completed'', ''cancelled'', ''voided''\))',
        '\1 and o.created_by_worker_id = v_context.worker_id', ''),
      ('public.close_worker_shift(text,numeric,text,text)',
        'Cannot close the last open shift: % active order\(s\) are still in progress \(%\)\. Complete or cancel them first\.',
        'You still have % active order(s) in progress (%). Complete or cancel them before closing your shift.', ''),

      ('public.get_shift_close_preview(text)',
        'if v_other_open_shifts = 0 then',
        'if true then', ''),
      ('public.get_shift_close_preview(text)',
        '(where o\.branch_id = v_session\.branch_id\s+and o\.status not in \(''completed'', ''cancelled'', ''voided''\))',
        '\1 and o.created_by_worker_id = v_session.worker_id', 'g'),
      ('public.get_shift_close_preview(text)',
        'case when v_other_open_shifts > 0 then v_carry_over_count else 0 end',
        '0', '')
    ) as t(sig, pat, rep, flags)
  loop
    d := pg_get_functiondef(r.sig::regprocedure);
    d2 := regexp_replace(d, r.pat, r.rep, r.flags);
    if d2 = d then
      raise exception 'Patch did not apply: % / %', r.sig, r.pat;
    end if;
    execute d2;
  end loop;
end
$mig$;

-- Handover is retired: nothing can be handed over, claimed or listed.
create or replace function public.handover_open_order(p_session_token text, p_order_id uuid, p_handover_note text, p_receiving_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $f$
begin
  perform public.get_pos_session_and_shift(p_session_token);
  raise exception 'Order handover is no longer available. Complete or cancel your own orders before closing your shift.';
end;
$f$;

create or replace function public.claim_handover_orders_for_shift(p_session_token text, p_order_ids uuid[], p_acknowledgement_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $f$
begin
  perform public.get_pos_session_and_shift(p_session_token);
  raise exception 'Order handover is no longer available.';
end;
$f$;

create or replace function public.get_pending_handover_orders(p_session_token text)
returns table(order_id uuid, order_number text, order_status text, fulfillment_type text, source text, customer_name text, customer_phone text, delivery_address text, rider_name text, total numeric, amount_paid numeric, balance_due numeric, payment_status text, handed_over_from_shift_id uuid, handed_over_by_worker_name text, handed_over_at timestamp with time zone, handover_note text)
language plpgsql security definer set search_path to 'public', 'extensions'
as $f$
begin
  perform public.get_pos_session_and_shift(p_session_token);
  return;
end;
$f$;

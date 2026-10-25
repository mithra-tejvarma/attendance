-- Run only against a disposable database after applying both migrations.
-- Synthetic data is rolled back. Raises an exception on failed invariants.
begin;
insert into public.students(id,profile) values('ffffffff-0000-0000-0000-000000000001','{}');
insert into public.app_sessions(token_hash,student_id,context,encrypted_connection,expires_at)
values(repeat('a',64),'ffffffff-0000-0000-0000-000000000001','{}','fixture',now()+interval '1 hour');
insert into public.push_subscriptions(token_hash,student_id,session_token_hash,encrypted_token,last_fingerprint,snapshot_day)
values(repeat('b',64),'ffffffff-0000-0000-0000-000000000001',repeat('a',64),'fixture','baseline',current_date);
do $$
declare owner_one uuid:='ffffffff-0000-0000-0000-000000000002';owner_two uuid:='ffffffff-0000-0000-0000-000000000003';counted integer;
begin
 assert not has_table_privilege('anon','public.push_subscriptions','SELECT');
 assert not has_table_privilege('authenticated','public.notification_outbox','SELECT');
 assert not has_function_privilege('anon','public.claim_notification_checks(uuid,integer)','EXECUTE');
 assert has_function_privilege('service_role','public.claim_notification_checks(uuid,integer)','EXECUTE');
 select count(*) into counted from public.claim_notification_checks(owner_one,2);assert counted=1;
 select count(*) into counted from public.claim_notification_checks(owner_two,2);assert counted=0;
 assert not public.finish_notification_check(repeat('b',64),owner_two,'changed',current_date,900,true);
 assert not public.finish_notification_check(repeat('b',64),owner_one,'baseline',current_date,900,true);
 assert (select count(*)=0 from public.notification_outbox);
 update public.push_subscriptions set next_check_at=now()-interval '1 second';
 perform public.claim_notification_checks(owner_one,2);
 assert public.finish_notification_check(repeat('b',64),owner_one,'changed',current_date,900,true);
 assert not public.finish_notification_check(repeat('b',64),owner_one,'changed',current_date,900,true);
 assert (select count(*)=1 from public.notification_outbox);
 select count(*) into counted from public.claim_notification_deliveries(owner_one,2);assert counted=1;
 select count(*) into counted from public.claim_notification_deliveries(owner_two,2);assert counted=0;
 update public.notification_outbox set lease_until=now()-interval '1 second';
 select count(*) into counted from public.claim_notification_deliveries(owner_two,2);assert counted=1;
 assert (select attempts=2 from public.notification_outbox);
 update public.notification_outbox set status='sent',lease_until=null,lease_owner=null;
 select count(*) into counted from public.claim_notification_deliveries(owner_one,2);assert counted=0;
 -- Use a clean quota day in this disposable database only.
 delete from public.firebase_usage_budget where quota_day=(now() at time zone 'America/Los_Angeles')::date;
 assert not public.reserve_firebase_usage_writes(2,1);
 assert public.reserve_firebase_usage_writes(2,3);
 assert public.reserve_firebase_usage_writes(1,3);
 assert not public.reserve_firebase_usage_writes(1,3);
 -- An expired session is not eligible and cleanup cascades both private tables.
 update public.app_sessions set expires_at=now()-interval '1 second';
 update public.push_subscriptions set next_check_at=now()-interval '1 second';
 select count(*) into counted from public.claim_notification_checks(owner_one,2);assert counted=0;
 perform public.cleanup_attendance_data();
 assert (select count(*)=0 from public.push_subscriptions);
 assert (select count(*)=0 from public.notification_outbox);
end;
$$;
rollback;

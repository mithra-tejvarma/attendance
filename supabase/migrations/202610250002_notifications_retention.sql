begin;
create table if not exists public.push_subscriptions (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 student_id uuid not null references public.students(id) on delete cascade,
 session_token_hash text not null references public.app_sessions(token_hash) on delete cascade,
 encrypted_token text not null,
 enabled boolean not null default true,
 last_fingerprint text not null,
 snapshot_day date not null,
 version integer not null default 0,
 next_check_at timestamptz not null default now(),
 checked_at timestamptz,
 lease_owner uuid,
 lease_until timestamptz
);
create index if not exists push_due on public.push_subscriptions(next_check_at) where enabled;
create index if not exists push_session on public.push_subscriptions(session_token_hash);
create table if not exists public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 subscription_hash text not null references public.push_subscriptions(token_hash) on delete cascade,
 version integer not null,
 status text not null default 'pending' check(status in ('pending','sent','dead')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 lease_owner uuid,
 lease_until timestamptz,
 unique(subscription_hash,version)
);
create index if not exists notification_pending on public.notification_outbox(next_attempt_at) where status='pending';
create index if not exists attendance_snapshot_retention on public.attendance_snapshots(fetched_at) where kind <> 'dashboard';
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on public.push_subscriptions,public.notification_outbox from anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions,public.notification_outbox to service_role;

create or replace function public.claim_notification_checks(p_owner uuid,p_limit integer)
returns setof public.push_subscriptions language sql security definer set search_path=public,pg_temp as $$
 with due as (
  select p.token_hash from public.push_subscriptions p join public.app_sessions s on s.token_hash=p.session_token_hash and s.student_id=p.student_id
  where p.enabled and s.expires_at>now() and p.next_check_at<=now() and (p.lease_until is null or p.lease_until<=now())
  order by p.next_check_at limit least(greatest(p_limit,1),12) for update of p skip locked
 ) update public.push_subscriptions p set lease_owner=p_owner,lease_until=now()+interval '120 seconds' from due where p.token_hash=due.token_hash returning p.*;
$$;
create or replace function public.finish_notification_check(p_hash text,p_owner uuid,p_fingerprint text,p_day date,p_interval integer,p_notify boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.push_subscriptions;changed boolean;new_version integer;
begin
 select * into item from public.push_subscriptions where token_hash=p_hash and lease_owner=p_owner for update;
 if not found then return false; end if;
 changed:=p_notify and item.last_fingerprint<>p_fingerprint;
 new_version:=item.version+case when changed then 1 else 0 end;
 if changed then insert into public.notification_outbox(subscription_hash,version) values(p_hash,new_version) on conflict do nothing; end if;
 update public.push_subscriptions set last_fingerprint=p_fingerprint,snapshot_day=p_day,version=new_version,checked_at=now(),next_check_at=now()+make_interval(secs=>least(greatest(p_interval,900),86400)),lease_owner=null,lease_until=null where token_hash=p_hash and lease_owner=p_owner;
 return changed;
end;
$$;
create or replace function public.claim_notification_deliveries(p_owner uuid,p_limit integer)
returns setof public.notification_outbox language sql security definer set search_path=public,pg_temp as $$
 with due as (
 select o.id from public.notification_outbox o join public.push_subscriptions p on p.token_hash=o.subscription_hash join public.app_sessions s on s.token_hash=p.session_token_hash
 where o.status='pending' and o.attempts<5 and o.next_attempt_at<=now() and (o.lease_until is null or o.lease_until<=now()) and p.enabled and s.expires_at>now()
 order by o.created_at limit least(greatest(p_limit,1),10) for update of o skip locked
 ) update public.notification_outbox o set lease_owner=p_owner,lease_until=now()+interval '120 seconds',attempts=o.attempts+1 from due where o.id=due.id returning o.*;
$$;
create or replace function public.cleanup_attendance_data()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;total integer:=0;
begin
 delete from public.app_sessions where token_hash in(select token_hash from public.app_sessions where expires_at<now() limit 1000);get diagnostics changed=row_count;total:=total+changed;
 delete from public.student_refresh_leases where student_id in(select student_id from public.student_refresh_leases where expires_at<now() limit 1000);get diagnostics changed=row_count;total:=total+changed;
 delete from public.attendance_snapshots where (student_id,kind) in(select student_id,kind from public.attendance_snapshots where (kind like 'today:%' and fetched_at<now()-interval '7 days') or (kind like 'month:%' and fetched_at<now()-interval '60 days') limit 1000);get diagnostics changed=row_count;total:=total+changed;
 delete from public.notification_outbox where id in(select id from public.notification_outbox where (status<>'pending' and created_at<now()-interval '7 days') or created_at<now()-interval '30 days' limit 1000);get diagnostics changed=row_count;return total+changed;
end;
$$;
revoke all on function public.claim_notification_checks(uuid,integer),public.finish_notification_check(text,uuid,text,date,integer,boolean),public.claim_notification_deliveries(uuid,integer),public.cleanup_attendance_data() from public,anon,authenticated;
grant execute on function public.claim_notification_checks(uuid,integer),public.finish_notification_check(text,uuid,text,date,integer,boolean),public.claim_notification_deliveries(uuid,integer),public.cleanup_attendance_data() to service_role;
create table if not exists public.firebase_usage_budget (quota_day date primary key,used integer not null check(used>=0));
alter table public.firebase_usage_budget enable row level security;
revoke all on public.firebase_usage_budget from anon,authenticated;
grant select,insert,update,delete on public.firebase_usage_budget to service_role;
create or replace function public.reserve_firebase_usage_writes(p_cost integer,p_limit integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
 if p_cost<1 or p_cost>4 or p_limit<1 or p_limit>16000 or p_cost>p_limit then return false;end if;
 insert into public.firebase_usage_budget(quota_day,used) values((now() at time zone 'America/Los_Angeles')::date,p_cost)
 on conflict(quota_day) do update set used=firebase_usage_budget.used+excluded.used where firebase_usage_budget.used+excluded.used<=p_limit;
 get diagnostics affected=row_count;return affected=1;
end;
$$;
revoke all on function public.reserve_firebase_usage_writes(integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_firebase_usage_writes(integer,integer) to service_role;
commit;
notify pgrst,'reload schema';

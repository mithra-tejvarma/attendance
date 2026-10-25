-- Apply through the Supabase SQL editor or migrations before enabling production.
-- No browser-facing policies: these tables are accessible only through the backend.
begin;
create table if not exists public.students (
  id uuid primary key,
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  updated_at timestamptz not null default now()
);
create table if not exists public.app_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  student_id uuid not null references public.students(id) on delete cascade,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  encrypted_connection text not null,
  expires_at timestamptz not null
);
create index if not exists app_sessions_expiry on public.app_sessions(expires_at);
create table if not exists public.attendance_snapshots (
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind ~ '^(dashboard|month:[0-9]{4}-[0-9]{2}|today:[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
  schema_version integer not null check (schema_version = 1),
  fetched_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (student_id, kind)
);
create table if not exists public.student_refresh_leases (
  student_id uuid primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.students enable row level security;
alter table public.app_sessions enable row level security;
alter table public.attendance_snapshots enable row level security;
alter table public.student_refresh_leases enable row level security;
revoke all on public.students, public.app_sessions, public.attendance_snapshots, public.student_refresh_leases from anon, authenticated;
grant select, insert, update, delete on public.students, public.app_sessions, public.attendance_snapshots, public.student_refresh_leases to service_role;

create or replace function public.claim_student_refresh(p_student_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare affected integer;
begin
  insert into public.student_refresh_leases(student_id, owner, expires_at)
  values(p_student_id, p_owner, now() + interval '120 seconds')
  on conflict(student_id) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where student_refresh_leases.expires_at <= now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
create or replace function public.release_student_refresh(p_student_id uuid, p_owner uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.student_refresh_leases where student_id = p_student_id and owner = p_owner;
$$;
revoke all on function public.claim_student_refresh(uuid, uuid), public.release_student_refresh(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_student_refresh(uuid, uuid), public.release_student_refresh(uuid, uuid) to service_role;
commit;

notify pgrst, 'reload schema';

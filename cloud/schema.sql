-- Dedicated objects only. Fail rather than overwrite a preexisting object.
begin;
create table public.core_console_state_v2 (
  workspace_id text primary key check (workspace_id = 'shared'),
  state jsonb,
  version bigint not null default 0,
  lease_owner uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.core_console_artifacts_v2 (
  workspace_id text not null check (workspace_id = 'shared'),
  name text not null check (name ~ '^task_[a-f0-9-]+-report\.md$'),
  content text not null check (octet_length(content) <= 65536),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, name)
);
create table public.core_console_email_challenges_v2 (
  email text primary key check (email in ('thefa@thefa.kr','ceo@thefa.kr')),
  id uuid not null unique,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  used_at timestamptz,
  last_sent_at timestamptz not null default now()
);
create table public.core_console_sessions_v2 (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null check (email in ('thefa@thefa.kr','ceo@thefa.kr')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.core_console_state_v2 enable row level security;
alter table public.core_console_artifacts_v2 enable row level security;
alter table public.core_console_email_challenges_v2 enable row level security;
alter table public.core_console_sessions_v2 enable row level security;
revoke all on public.core_console_state_v2, public.core_console_artifacts_v2, public.core_console_email_challenges_v2, public.core_console_sessions_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.core_console_state_v2, public.core_console_artifacts_v2, public.core_console_email_challenges_v2, public.core_console_sessions_v2 to service_role;

create function public.core_console_acquire_lease_v2(p_owner uuid, p_seconds integer default 120)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.core_console_state_v2; recovered boolean;
begin
  if p_owner is null or p_seconds is null or p_seconds < 30 or p_seconds > 300 then raise exception 'INVALID_LEASE'; end if;
  insert into public.core_console_state_v2(workspace_id) values ('shared') on conflict do nothing;
  select * into r from public.core_console_state_v2 where workspace_id='shared' for update;
  if r.lease_owner is not null and r.lease_owner <> p_owner and r.lease_until > clock_timestamp() then
    return jsonb_build_object('granted', false, 'version', r.version, 'lease_until', r.lease_until, 'recovered', false);
  end if;
  recovered := r.lease_owner is not null and r.lease_owner <> p_owner and r.lease_until <= clock_timestamp();
  update public.core_console_state_v2 set lease_owner=p_owner, lease_until=clock_timestamp()+make_interval(secs=>p_seconds), updated_at=clock_timestamp() where workspace_id='shared' returning * into r;
  return jsonb_build_object('granted', true, 'state',r.state,'version',r.version,'lease_owner',r.lease_owner,'lease_until',r.lease_until,'recovered',coalesce(recovered,false));
end $$;
create function public.core_console_save_state_v2(p_owner uuid, p_expected_version bigint, p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.core_console_state_v2;
begin
  select * into r from public.core_console_state_v2 where workspace_id='shared' for update;
  if not found or p_owner is null or r.lease_owner is distinct from p_owner or r.lease_until is null or r.lease_until <= clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if r.version is distinct from p_expected_version then raise exception 'STATE_VERSION_CONFLICT'; end if;
  if p_state is null or p_state->>'version' is distinct from '2' or jsonb_typeof(p_state->'tasks') is distinct from 'array' or jsonb_typeof(p_state->'artifacts') is distinct from 'array' or jsonb_typeof(p_state->'receipts') is distinct from 'array' or jsonb_typeof(p_state->'memory') is distinct from 'array' or jsonb_typeof(p_state->'idempotency') is distinct from 'object' or octet_length(p_state::text)>4194304 then raise exception 'INVALID_STATE'; end if;
  update public.core_console_state_v2 set state=p_state, version=version+1,updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '120 seconds' where workspace_id='shared' returning * into r;
  return jsonb_build_object('version',r.version);
end $$;
create function public.core_console_release_lease_v2(p_owner uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  update public.core_console_state_v2 set lease_owner=null,lease_until=null,updated_at=clock_timestamp() where workspace_id='shared' and lease_owner=p_owner;
  return jsonb_build_object('released',found);
end $$;
create function public.core_console_put_artifact_v2(p_owner uuid,p_name text,p_content text,p_sha256 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare r public.core_console_state_v2; existing public.core_console_artifacts_v2;
begin
  select * into r from public.core_console_state_v2 where workspace_id='shared' for update;
  if not found or p_owner is null or r.lease_owner is distinct from p_owner or r.lease_until is null or r.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if p_name is null or p_content is null or p_sha256 is null or encode(extensions.digest(convert_to(p_content,'UTF8'),'sha256'),'hex') is distinct from p_sha256 then raise exception 'ARTIFACT_HASH_MISMATCH'; end if;
  select * into existing from public.core_console_artifacts_v2 where workspace_id='shared' and name=p_name;
  if found then
    if existing.content<>p_content or existing.sha256<>p_sha256 then raise exception 'ARTIFACT_IMMUTABLE'; end if;
  else
    insert into public.core_console_artifacts_v2(workspace_id,name,content,sha256) values('shared',p_name,p_content,p_sha256);
  end if;
  return jsonb_build_object('name',p_name,'sha256',p_sha256);
end $$;

create function public.core_console_request_code_v2(p_email text,p_challenge_id uuid,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.core_console_email_challenges_v2;
begin
  if p_email not in ('thefa@thefa.kr','ceo@thefa.kr') or p_email is null then raise exception 'EMAIL_NOT_ALLOWED'; end if;
  insert into public.core_console_email_challenges_v2(email,id,code_hash,expires_at,last_sent_at)
    values(p_email,p_challenge_id,p_code_hash,clock_timestamp()+interval '10 minutes',clock_timestamp())
    on conflict(email) do update set id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,used_at=null,last_sent_at=excluded.last_sent_at
    where core_console_email_challenges_v2.last_sent_at <= clock_timestamp()-interval '60 seconds'
    returning * into r;
  if not found then return jsonb_build_object('accepted',false,'retryAfter',60); end if;
  return jsonb_build_object('accepted',true,'challengeId',r.id,'expiresIn',600);
end $$;
create function public.core_console_verify_code_v2(p_challenge_id uuid,p_code_hash text,p_session_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.core_console_email_challenges_v2; expiry timestamptz := clock_timestamp()+interval '8 hours';
begin
  if p_challenge_id is null or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('verified',false); end if;
  select * into r from public.core_console_email_challenges_v2 where id=p_challenge_id for update;
  if not found or r.used_at is not null or r.expires_at<=clock_timestamp() or r.attempts>=5 then return jsonb_build_object('verified',false); end if;
  update public.core_console_email_challenges_v2 set attempts=attempts+1 where email=r.email;
  if r.code_hash is distinct from p_code_hash then return jsonb_build_object('verified',false); end if;
  update public.core_console_email_challenges_v2 set used_at=clock_timestamp() where email=r.email;
  insert into public.core_console_sessions_v2(token_hash,email,expires_at) values(p_session_hash,r.email,expiry);
  return jsonb_build_object('verified',true,'email',r.email,'expiresAt',expiry);
end $$;

revoke all on function public.core_console_acquire_lease_v2(uuid,integer),public.core_console_save_state_v2(uuid,bigint,jsonb),public.core_console_release_lease_v2(uuid),public.core_console_put_artifact_v2(uuid,text,text,text),public.core_console_request_code_v2(text,uuid,text),public.core_console_verify_code_v2(uuid,text,text) from public,anon,authenticated;
grant execute on function public.core_console_acquire_lease_v2(uuid,integer),public.core_console_save_state_v2(uuid,bigint,jsonb),public.core_console_release_lease_v2(uuid),public.core_console_put_artifact_v2(uuid,text,text,text),public.core_console_request_code_v2(text,uuid,text),public.core_console_verify_code_v2(uuid,text,text) to service_role;
commit;

-- Root executes this against the dedicated pilot schema after migration.
-- All data changes roll back. No provider, mail, or real user session is created.
-- Assertions are outside the exception blocks that test expected rejection.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  owner_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  owner_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  challenge_a uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  challenge_b uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  artifact_name text := 'task_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-report.md';
  state_data jsonb := '{"version":2,"tasks":[],"artifacts":[],"receipts":[],"memory":[],"idempotency":{}}'::jsonb;
  artifact_content text := 'REAL cloud database canary: sandbox only';
  artifact_hash text;
  code_hash text := repeat('1',64);
  wrong_hash text := repeat('2',64);
  session_hash text := repeat('3',64);
  result jsonb;
  old_version bigint;
  new_version bigint;
  rejected boolean;
  relation_name text;
  function_name text;
  role_name text;
  privilege_name text;
  count_before bigint;
  index integer;
begin
  -- The migration uses extensions.digest explicitly; fail if pgcrypto is elsewhere.
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'CANARY_FAIL: extensions.digest(bytea,text) is unavailable';
  end if;
  artifact_hash := encode(extensions.digest(convert_to(artifact_content,'UTF8'),'sha256'),'hex');

  foreach relation_name in array array['core_console_state_v2','core_console_artifacts_v2','core_console_email_challenges_v2','core_console_sessions_v2'] loop
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||relation_name)) then raise exception 'CANARY_FAIL: RLS disabled on %', relation_name; end if;
    foreach role_name in array array['anon','authenticated'] loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(role_name,'public.'||relation_name,privilege_name) then raise exception 'CANARY_FAIL: % has % on %',role_name,privilege_name,relation_name; end if;
      end loop;
    end loop;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||relation_name,privilege_name) then raise exception 'CANARY_FAIL: service_role missing % on %',privilege_name,relation_name; end if;
    end loop;
    -- PUBLIC is a pseudo-role, not a pg_roles row; has_table_privilege('public',...) is invalid.
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=to_regclass('public.'||relation_name) and a.grantee=0) then raise exception 'CANARY_FAIL: PUBLIC table ACL on %',relation_name; end if;
  end loop;
  foreach function_name in array array[
    'core_console_acquire_lease_v2(uuid,integer)',
    'core_console_save_state_v2(uuid,bigint,jsonb)',
    'core_console_release_lease_v2(uuid)',
    'core_console_put_artifact_v2(uuid,text,text,text)',
    'core_console_request_code_v2(text,uuid,text)',
    'core_console_verify_code_v2(uuid,text,text)'
  ] loop
    foreach role_name in array array['anon','authenticated'] loop
      if has_function_privilege(role_name,'public.'||function_name,'EXECUTE') then raise exception 'CANARY_FAIL: % can execute %',role_name,function_name; end if;
    end loop;
    if not has_function_privilege('service_role','public.'||function_name,'EXECUTE') then raise exception 'CANARY_FAIL: service_role missing execute %',function_name; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=to_regprocedure('public.'||function_name) and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'CANARY_FAIL: PUBLIC can execute %',function_name; end if;
    if (select prosecdef from pg_proc where oid=to_regprocedure('public.'||function_name)) then raise exception 'CANARY_FAIL: unexpected SECURITY DEFINER %',function_name; end if;
  end loop;

  -- Protect an already active writer. Tests are for an idle, dedicated pilot schema.
  if exists(select 1 from public.core_console_state_v2 where workspace_id='shared' and lease_owner is not null and lease_until>clock_timestamp()) then raise exception 'CANARY_BLOCKED_ACTIVE_WRITER'; end if;
  result := public.core_console_acquire_lease_v2(owner_a,120);
  if result->>'granted' is distinct from 'true' or result->>'lease_owner' is distinct from owner_a::text then raise exception 'CANARY_FAIL: first lease'; end if;
  old_version := (result->>'version')::bigint;
  result := public.core_console_acquire_lease_v2(owner_b,120);
  if result->>'granted' is distinct from 'false' then raise exception 'CANARY_FAIL: second writer admitted'; end if;
  if (select lease_owner from public.core_console_state_v2 where workspace_id='shared') is distinct from owner_a then raise exception 'CANARY_FAIL: contention clobbered owner'; end if;
  result := public.core_console_save_state_v2(owner_a,old_version,state_data);
  new_version := (result->>'version')::bigint;
  if new_version is distinct from old_version+1 then raise exception 'CANARY_FAIL: version did not increment'; end if;
  rejected := false;
  begin perform public.core_console_save_state_v2(owner_a,old_version,state_data); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: stale CAS accepted'; end if;
  if (select version from public.core_console_state_v2 where workspace_id='shared') is distinct from new_version then raise exception 'CANARY_FAIL: stale CAS changed version'; end if;

  -- Explicit NULL input guards must reject SQL three-valued comparison bypasses.
  rejected := false;
  begin perform public.core_console_acquire_lease_v2(null,120); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL lease owner accepted'; end if;
  rejected := false;
  begin perform public.core_console_acquire_lease_v2(owner_a,null); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL lease seconds accepted'; end if;
  rejected := false;
  begin perform public.core_console_save_state_v2(owner_a,null,state_data); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL expected version accepted'; end if;
  foreach result in array array[null::jsonb,'{}'::jsonb,'{"version":2}'::jsonb,'{"version":2,"tasks":null}'::jsonb,'{"version":2,"tasks":[],"artifacts":[],"receipts":[],"memory":[],"idempotency":null}'::jsonb] loop
    rejected := false;
    begin perform public.core_console_save_state_v2(owner_a,new_version,result); exception when raise_exception then rejected := true; end;
    if not rejected then raise exception 'CANARY_FAIL: NULL/incomplete state accepted'; end if;
  end loop;
  if (select state from public.core_console_state_v2 where workspace_id='shared') is distinct from state_data then raise exception 'CANARY_FAIL: rejected state changed persisted JSON'; end if;

  result := public.core_console_put_artifact_v2(owner_a,artifact_name,artifact_content,artifact_hash);
  if result->>'sha256' is distinct from artifact_hash then raise exception 'CANARY_FAIL: artifact hash'; end if;
  result := public.core_console_put_artifact_v2(owner_a,artifact_name,artifact_content,artifact_hash);
  if result->>'sha256' is distinct from artifact_hash then raise exception 'CANARY_FAIL: idempotent artifact'; end if;
  rejected := false;
  begin perform public.core_console_put_artifact_v2(owner_a,artifact_name,artifact_content,wrong_hash); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: artifact wrong hash accepted'; end if;
  rejected := false;
  begin perform public.core_console_put_artifact_v2(owner_a,artifact_name,'changed',encode(extensions.digest(convert_to('changed','UTF8'),'sha256'),'hex')); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: existing artifact overwritten'; end if;
  rejected := false;
  begin perform public.core_console_put_artifact_v2(owner_a,artifact_name,null,artifact_hash); exception when raise_exception or not_null_violation then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL artifact accepted'; end if;
  if (select content from public.core_console_artifacts_v2 where workspace_id='shared' and name=artifact_name) is distinct from artifact_content then raise exception 'CANARY_FAIL: immutable artifact changed'; end if;

  update public.core_console_state_v2 set lease_until=clock_timestamp()-interval '1 second' where workspace_id='shared';
  result := public.core_console_acquire_lease_v2(owner_b,120);
  if result->>'granted' is distinct from 'true' or result->>'recovered' is distinct from 'true' then raise exception 'CANARY_FAIL: expired different owner not recovered'; end if;
  rejected := false;
  begin perform public.core_console_save_state_v2(owner_a,new_version,state_data); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: stale owner can write'; end if;
  result := public.core_console_release_lease_v2(owner_a);
  if result->>'released' is distinct from 'false' then raise exception 'CANARY_FAIL: stale owner released current lease'; end if;
  result := public.core_console_release_lease_v2(owner_b);
  if result->>'released' is distinct from 'true' then raise exception 'CANARY_FAIL: owner release'; end if;
  rejected := false;
  begin perform public.core_console_save_state_v2(null,new_version,state_data); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: released NULL owner can write'; end if;
  result := public.core_console_acquire_lease_v2(owner_a,120);
  if result->>'recovered' is distinct from 'false' then raise exception 'CANARY_FAIL: released lease mistaken for expired recovery'; end if;

  -- Isolated challenge records, restored by the enclosing ROLLBACK.
  delete from public.core_console_email_challenges_v2 where email in ('thefa@thefa.kr','ceo@thefa.kr');
  delete from public.core_console_sessions_v2 where token_hash in (session_hash,repeat('4',64),repeat('5',64));
  rejected := false;
  begin perform public.core_console_request_code_v2('outsider@example.invalid',challenge_a,code_hash); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: outsider can request OTP'; end if;
  rejected := false;
  begin perform public.core_console_request_code_v2(null,challenge_a,code_hash); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL email accepted'; end if;
  result := public.core_console_request_code_v2('thefa@thefa.kr',challenge_a,code_hash);
  if result->>'accepted' is distinct from 'true' or result->>'challengeId' is distinct from challenge_a::text then raise exception 'CANARY_FAIL: allowed email challenge'; end if;
  result := public.core_console_request_code_v2('thefa@thefa.kr',challenge_b,wrong_hash);
  if result->>'accepted' is distinct from 'false' or result->>'retryAfter' is distinct from '60' then raise exception 'CANARY_FAIL: cooldown bypass'; end if;
  if (select id from public.core_console_email_challenges_v2 where email='thefa@thefa.kr') is distinct from challenge_a then raise exception 'CANARY_FAIL: cooldown replaced challenge'; end if;
  -- NULL OTP may raise validation or return verified=false; verified=true is always a failure.
  rejected := false; result := null;
  begin result := public.core_console_verify_code_v2(challenge_a,null,session_hash); exception when raise_exception then rejected := true; end;
  if not rejected and result->>'verified' is distinct from 'false' then raise exception 'CANARY_FAIL: NULL OTP bypass'; end if;
  if exists(select 1 from public.core_console_sessions_v2 where token_hash=session_hash) then raise exception 'CANARY_FAIL: NULL OTP created session'; end if;
  for index in 1..5 loop
    result := public.core_console_verify_code_v2(challenge_a,wrong_hash,session_hash);
    if result->>'verified' is distinct from 'false' then raise exception 'CANARY_FAIL: wrong OTP accepted'; end if;
  end loop;
  if (select attempts from public.core_console_email_challenges_v2 where id=challenge_a) is distinct from 5::smallint then raise exception 'CANARY_FAIL: OTP attempt counter'; end if;
  result := public.core_console_verify_code_v2(challenge_a,code_hash,session_hash);
  if result->>'verified' is distinct from 'false' then raise exception 'CANARY_FAIL: sixth OTP attempt accepted'; end if;
  if exists(select 1 from public.core_console_sessions_v2 where token_hash=session_hash) then raise exception 'CANARY_FAIL: exhausted OTP created session'; end if;

  update public.core_console_email_challenges_v2 set last_sent_at=clock_timestamp()-interval '61 seconds' where email='thefa@thefa.kr';
  result := public.core_console_request_code_v2('thefa@thefa.kr',challenge_b,code_hash);
  if result->>'accepted' is distinct from 'true' then raise exception 'CANARY_FAIL: cooldown never expires'; end if;
  update public.core_console_email_challenges_v2 set expires_at=clock_timestamp()-interval '1 second' where id=challenge_b;
  result := public.core_console_verify_code_v2(challenge_b,code_hash,session_hash);
  if result->>'verified' is distinct from 'false' then raise exception 'CANARY_FAIL: expired OTP accepted'; end if;
  result := public.core_console_request_code_v2('ceo@thefa.kr',challenge_a,code_hash);
  if result->>'accepted' is distinct from 'true' then raise exception 'CANARY_FAIL: second allowed email'; end if;
  result := public.core_console_verify_code_v2(challenge_a,code_hash,session_hash);
  if result->>'verified' is distinct from 'true' or result->>'email' is distinct from 'ceo@thefa.kr' then raise exception 'CANARY_FAIL: correct OTP rejected'; end if;
  if not exists(select 1 from public.core_console_sessions_v2 where token_hash=session_hash and email='ceo@thefa.kr' and expires_at>clock_timestamp()+interval '7 hours 59 minutes' and expires_at<=clock_timestamp()+interval '8 hours') then raise exception 'CANARY_FAIL: eight hour session'; end if;
  select count(*) into count_before from public.core_console_sessions_v2;
  result := public.core_console_verify_code_v2(challenge_a,code_hash,repeat('4',64));
  if result->>'verified' is distinct from 'false' then raise exception 'CANARY_FAIL: reused OTP accepted'; end if;
  if (select count(*) from public.core_console_sessions_v2) is distinct from count_before then raise exception 'CANARY_FAIL: reused OTP created another session'; end if;

  rejected := false;
  begin insert into public.core_console_sessions_v2(token_hash,email,expires_at) values('short','ceo@thefa.kr',clock_timestamp()+interval '1 hour'); exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: invalid session hash accepted'; end if;
  rejected := false;
  begin insert into public.core_console_sessions_v2(token_hash,email,expires_at) values(repeat('5',64),'outsider@example.invalid',clock_timestamp()+interval '1 hour'); exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: outsider session accepted'; end if;
  rejected := false;
  begin insert into public.core_console_sessions_v2(token_hash,email,expires_at) values(repeat('5',64),'ceo@thefa.kr',null); exception when not_null_violation then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: NULL session expiry accepted'; end if;
  rejected := false;
  begin insert into public.core_console_sessions_v2(token_hash,email,expires_at) values(session_hash,'ceo@thefa.kr',clock_timestamp()+interval '1 hour'); exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'CANARY_FAIL: duplicate session token accepted'; end if;
  raise notice 'CORE_CONSOLE_DATABASE_CANARY_PASS: ACL/RLS, lease/CAS/recovery, NULL guards, immutable/hash artifact, email/cooldown, OTP attempts/expiry/one-use, session constraints';
end $$;

rollback;

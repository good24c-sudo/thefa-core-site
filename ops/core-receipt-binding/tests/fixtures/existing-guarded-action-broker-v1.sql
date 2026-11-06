-- THE FA guarded action broker v1
-- Durable, idempotent action ledger. Does not grant authority from AI input.

create table if not exists public.ceo_core_guarded_action_ledger (
  action_id uuid primary key default gen_random_uuid(),
  context_lease_id text not null,
  work_identity_binding_hash text not null check (work_identity_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  adapter_instance_id text not null,
  adapter_epoch bigint not null check (adapter_epoch >= 1),
  action_type text not null,
  risk_class text not null check (risk_class in ('GUARDED','RED')),
  target_provider text not null check (target_provider in ('GITHUB','DRIVE','SUPABASE','CORE')),
  intent jsonb not null,
  intent_hash text not null check (intent_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text not null,
  owned_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(owned_paths)='array'),
  owned_paths_hash text not null check (owned_paths_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_parent_head text,
  prepared_action_hash text not null check (prepared_action_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null default 'PREPARED' check (state in (
    'PREPARED','AUTHORIZED','DISPATCHING','RECEIPT_PENDING','FAILED_RETRYABLE','RECONCILING',
    'COMPLETED','FAILED_FINAL','CANCELLED','SUPERSEDED'
  )),
  authority_receipt_hash text check (authority_receipt_hash is null or authority_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  writer_lease_id text,
  fencing_generation bigint check (fencing_generation is null or fencing_generation >= 1),
  fresh_source_binding_hash text check (fresh_source_binding_hash is null or fresh_source_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_revision text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_id uuid,
  result_binding_hash text check (result_binding_hash is null or result_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  failure_code text,
  prepared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(work_identity_binding_hash,target_provider,idempotency_key),
  check (target_provider <> 'GITHUB' or expected_parent_head ~ '^[0-9a-f]{40}$')
);

create index if not exists ceo_core_guarded_action_state_idx
  on public.ceo_core_guarded_action_ledger(state,updated_at);
create index if not exists ceo_core_guarded_action_binding_idx
  on public.ceo_core_guarded_action_ledger(work_identity_binding_hash,prepared_at desc);

create table if not exists public.ceo_core_guarded_action_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.ceo_core_guarded_action_ledger(action_id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  execution_request_hash text not null check (execution_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_receipt_hash text not null check (authority_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  fencing_generation bigint not null check (fencing_generation >= 1),
  outcome text not null default 'DISPATCHING' check (outcome in (
    'DISPATCHING','ACCEPTED_RECEIPT_PENDING','AMBIGUOUS','RETRYABLE_FAILURE','FINAL_FAILURE','RECEIPT_VERIFIED'
  )),
  provider_operation_id text,
  provider_request_hash text check (provider_request_hash is null or provider_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  failure_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(action_id,attempt_no),
  unique(action_id,execution_request_hash)
);

create index if not exists ceo_core_guarded_action_attempt_action_idx
  on public.ceo_core_guarded_action_attempts(action_id,attempt_no desc);

create table if not exists public.ceo_core_guarded_action_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.ceo_core_guarded_action_ledger(action_id) on delete cascade,
  attempt_id uuid not null references public.ceo_core_guarded_action_attempts(attempt_id) on delete cascade,
  provider text not null check (provider in ('GITHUB','DRIVE','SUPABASE','CORE')),
  provider_operation_id text not null,
  provider_request_hash text not null check (provider_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_receipt_hash text not null unique check (provider_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_binding_hash text not null check (result_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_receipt_hash text not null check (authority_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  fencing_generation bigint not null check (fencing_generation >= 1),
  receipt_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt_metadata)='object'),
  verified_at timestamptz not null default now(),
  unique(action_id,provider_operation_id)
);

create or replace function public.ceo_core_prepare_guarded_action_v1(
  p_context_lease_id text,
  p_work_identity_binding_hash text,
  p_adapter_instance_id text,
  p_adapter_epoch bigint,
  p_action_type text,
  p_risk_class text,
  p_target_provider text,
  p_intent jsonb,
  p_idempotency_key text,
  p_owned_paths jsonb default '[]'::jsonb,
  p_expected_parent_head text default null
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  v_action_type text:=upper(btrim(coalesce(p_action_type,'')));
  v_risk text:=upper(btrim(coalesce(p_risk_class,'')));
  v_provider text:=upper(btrim(coalesce(p_target_provider,'')));
  v_intent_hash text;
  v_owned_hash text;
  v_prepared_hash text;
  v_payload jsonb;
  v_existing public.ceo_core_guarded_action_ledger%rowtype;
  v_id uuid;
begin
  if nullif(btrim(p_context_lease_id),'') is null or nullif(btrim(p_adapter_instance_id),'') is null
     or nullif(btrim(p_idempotency_key),'') is null then
    return jsonb_build_object('decision','BLOCKED_REQUIRED_IDENTITY_MISSING');
  end if;
  if p_work_identity_binding_hash !~ '^sha256:[0-9a-f]{64}$' or coalesce(p_adapter_epoch,0) < 1 then
    return jsonb_build_object('decision','BLOCKED_WORK_OR_ADAPTER_IDENTITY_INVALID');
  end if;
  if v_provider not in ('GITHUB','DRIVE','SUPABASE','CORE') or v_risk not in ('GUARDED','RED') then
    return jsonb_build_object('decision','BLOCKED_PROVIDER_OR_RISK_INVALID');
  end if;
  if coalesce(jsonb_typeof(p_intent),'null') <> 'object' or coalesce(jsonb_typeof(p_owned_paths),'null') <> 'array' then
    return jsonb_build_object('decision','BLOCKED_INTENT_OR_PATHS_SHAPE_INVALID');
  end if;
  if public.ceo_core_jsonb_has_sensitive_key_v1(p_intent) or public.ceo_core_jsonb_has_sensitive_key_v1(p_owned_paths) then
    return jsonb_build_object('decision','BLOCKED_SECRET_OR_RAW_PII');
  end if;
  if v_provider='GITHUB' and (coalesce(p_expected_parent_head,'') !~ '^[0-9a-f]{40}$' or jsonb_array_length(p_owned_paths)=0) then
    return jsonb_build_object('decision','BLOCKED_GITHUB_BINDING_INCOMPLETE');
  end if;
  if v_provider<>'GITHUB' and p_expected_parent_head is not null then
    return jsonb_build_object('decision','BLOCKED_EXPECTED_PARENT_PROVIDER_MISMATCH');
  end if;

  v_intent_hash:='sha256:'||encode(extensions.digest(p_intent::text,'sha256'),'hex');
  v_owned_hash:='sha256:'||encode(extensions.digest(p_owned_paths::text,'sha256'),'hex');
  v_payload:=jsonb_build_object(
    'context_lease_id',btrim(p_context_lease_id),'work_identity_binding_hash',p_work_identity_binding_hash,
    'adapter_instance_id',btrim(p_adapter_instance_id),'adapter_epoch',p_adapter_epoch,
    'action_type',v_action_type,'risk_class',v_risk,'target_provider',v_provider,
    'intent',p_intent,'idempotency_key',btrim(p_idempotency_key),'owned_paths',p_owned_paths,
    'expected_parent_head',p_expected_parent_head
  );
  v_prepared_hash:='sha256:'||encode(extensions.digest(v_payload::text,'sha256'),'hex');

  select * into v_existing from public.ceo_core_guarded_action_ledger
   where work_identity_binding_hash=p_work_identity_binding_hash
     and target_provider=v_provider and idempotency_key=btrim(p_idempotency_key)
   for update;
  if found then
    if v_existing.prepared_action_hash=v_prepared_hash and v_existing.intent_hash=v_intent_hash then
      return jsonb_build_object('decision','DUPLICATE_NOOP','action_id',v_existing.action_id,'state',v_existing.state,
        'prepared_action_hash',v_existing.prepared_action_hash);
    end if;
    return jsonb_build_object('decision','BLOCKED_IDEMPOTENCY_CONFLICT','action_id',v_existing.action_id,'state',v_existing.state);
  end if;

  insert into public.ceo_core_guarded_action_ledger(
    context_lease_id,work_identity_binding_hash,adapter_instance_id,adapter_epoch,action_type,risk_class,target_provider,
    intent,intent_hash,idempotency_key,owned_paths,owned_paths_hash,expected_parent_head,prepared_action_hash
  ) values (
    btrim(p_context_lease_id),p_work_identity_binding_hash,btrim(p_adapter_instance_id),p_adapter_epoch,v_action_type,v_risk,v_provider,
    p_intent,v_intent_hash,btrim(p_idempotency_key),p_owned_paths,v_owned_hash,p_expected_parent_head,v_prepared_hash
  ) returning action_id into v_id;

  return jsonb_build_object('decision','ACTION_PREPARED','action_id',v_id,'state','PREPARED','prepared_action_hash',v_prepared_hash,
    'intent_hash',v_intent_hash,'write_authority',false);
end;$function$;

create or replace function public.ceo_core_claim_guarded_action_execution_v1(
  p_action_id uuid,
  p_execution_request_hash text,
  p_authority_receipt_hash text,
  p_writer_lease_id text,
  p_fencing_generation bigint,
  p_fresh_source_binding_hash text,
  p_policy_revision text
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  v_action public.ceo_core_guarded_action_ledger%rowtype;
  v_last public.ceo_core_guarded_action_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_no integer;
begin
  if p_execution_request_hash !~ '^sha256:[0-9a-f]{64}$'
     or p_authority_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
     or p_fresh_source_binding_hash !~ '^sha256:[0-9a-f]{64}$'
     or coalesce(p_fencing_generation,0)<1 or nullif(btrim(p_writer_lease_id),'') is null
     or nullif(btrim(p_policy_revision),'') is null then
    return jsonb_build_object('decision','BLOCKED_AUTHORITY_BINDING_INVALID');
  end if;

  select * into v_action from public.ceo_core_guarded_action_ledger where action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ACTION_NOT_FOUND'); end if;
  if v_action.state in ('COMPLETED','FAILED_FINAL','CANCELLED','SUPERSEDED') then
    return jsonb_build_object('decision','DUPLICATE_NOOP_TERMINAL','state',v_action.state,'action_id',v_action.action_id);
  end if;
  if v_action.state in ('DISPATCHING','RECEIPT_PENDING','RECONCILING') then
    return jsonb_build_object('decision','BLOCKED_REDISPATCH_REQUIRES_RECONCILIATION','state',v_action.state);
  end if;
  if v_action.state not in ('PREPARED','AUTHORIZED','FAILED_RETRYABLE') then
    return jsonb_build_object('decision','BLOCKED_STATE_NOT_EXECUTABLE','state',v_action.state);
  end if;

  select * into v_last from public.ceo_core_guarded_action_attempts
   where action_id=p_action_id order by attempt_no desc limit 1;
  if found and v_last.outcome in ('AMBIGUOUS','ACCEPTED_RECEIPT_PENDING') then
    return jsonb_build_object('decision','BLOCKED_REDISPATCH_REQUIRES_RECONCILIATION','last_outcome',v_last.outcome);
  end if;

  select attempt_id into v_attempt_id from public.ceo_core_guarded_action_attempts
   where action_id=p_action_id and execution_request_hash=p_execution_request_hash;
  if found then
    return jsonb_build_object('decision','DUPLICATE_NOOP_EXECUTION_REQUEST','attempt_id',v_attempt_id,'action_id',p_action_id);
  end if;

  v_attempt_no:=v_action.attempt_count+1;
  insert into public.ceo_core_guarded_action_attempts(
    action_id,attempt_no,execution_request_hash,authority_receipt_hash,fencing_generation
  ) values (p_action_id,v_attempt_no,p_execution_request_hash,p_authority_receipt_hash,p_fencing_generation)
  returning attempt_id into v_attempt_id;

  update public.ceo_core_guarded_action_ledger set
    state='DISPATCHING',authority_receipt_hash=p_authority_receipt_hash,writer_lease_id=btrim(p_writer_lease_id),
    fencing_generation=p_fencing_generation,fresh_source_binding_hash=p_fresh_source_binding_hash,
    policy_revision=btrim(p_policy_revision),attempt_count=v_attempt_no,last_attempt_id=v_attempt_id,
    failure_code=null,updated_at=now()
  where action_id=p_action_id;

  return jsonb_build_object('decision','EXECUTION_CLAIMED','action_id',p_action_id,'attempt_id',v_attempt_id,
    'attempt_no',v_attempt_no,'state','DISPATCHING','fencing_generation',p_fencing_generation);
end;$function$;

create or replace function public.ceo_core_record_guarded_action_provider_result_v1(
  p_action_id uuid,
  p_attempt_id uuid,
  p_result_kind text,
  p_provider_operation_id text default null,
  p_provider_request_hash text default null,
  p_failure_code text default null
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  v_kind text:=upper(btrim(coalesce(p_result_kind,'')));
  v_action public.ceo_core_guarded_action_ledger%rowtype;
  v_attempt public.ceo_core_guarded_action_attempts%rowtype;
  v_state text;
  v_outcome text;
begin
  select * into v_action from public.ceo_core_guarded_action_ledger where action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ACTION_NOT_FOUND'); end if;
  select * into v_attempt from public.ceo_core_guarded_action_attempts where attempt_id=p_attempt_id and action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ATTEMPT_NOT_FOUND'); end if;
  if v_action.state not in ('DISPATCHING','RECONCILING') then
    return jsonb_build_object('decision','BLOCKED_RESULT_STATE_INVALID','state',v_action.state);
  end if;
  if p_provider_request_hash is not null and p_provider_request_hash !~ '^sha256:[0-9a-f]{64}$' then
    return jsonb_build_object('decision','BLOCKED_PROVIDER_REQUEST_HASH_INVALID');
  end if;

  case v_kind
    when 'ACCEPTED_RECEIPT_PENDING' then v_state:='RECEIPT_PENDING'; v_outcome:='ACCEPTED_RECEIPT_PENDING';
    when 'AMBIGUOUS' then v_state:='RECEIPT_PENDING'; v_outcome:='AMBIGUOUS';
    when 'DEFINITIVE_RETRYABLE_FAILURE' then v_state:='FAILED_RETRYABLE'; v_outcome:='RETRYABLE_FAILURE';
    when 'DEFINITIVE_FINAL_FAILURE' then v_state:='FAILED_FINAL'; v_outcome:='FINAL_FAILURE';
    else return jsonb_build_object('decision','BLOCKED_RESULT_KIND_INVALID');
  end case;

  update public.ceo_core_guarded_action_attempts set outcome=v_outcome,
    provider_operation_id=nullif(btrim(p_provider_operation_id),''),provider_request_hash=p_provider_request_hash,
    failure_code=left(nullif(btrim(p_failure_code),''),160),finished_at=now()
  where attempt_id=p_attempt_id;
  update public.ceo_core_guarded_action_ledger set state=v_state,failure_code=left(nullif(btrim(p_failure_code),''),160),updated_at=now(),
    completed_at=case when v_state='FAILED_FINAL' then now() else completed_at end
  where action_id=p_action_id;

  return jsonb_build_object('decision',case when v_state='RECEIPT_PENDING' then 'RECONCILE_BEFORE_RETRY' else 'PROVIDER_RESULT_RECORDED' end,
    'action_id',p_action_id,'attempt_id',p_attempt_id,'state',v_state,'blind_redispatch_allowed',false);
end;$function$;

create or replace function public.ceo_core_finalize_guarded_action_v1(
  p_action_id uuid,
  p_attempt_id uuid,
  p_provider text,
  p_provider_operation_id text,
  p_provider_request_hash text,
  p_provider_receipt_hash text,
  p_result_binding_hash text,
  p_authority_receipt_hash text,
  p_fencing_generation bigint,
  p_receipt_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  v_action public.ceo_core_guarded_action_ledger%rowtype;
  v_attempt public.ceo_core_guarded_action_attempts%rowtype;
  v_receipt_id uuid;
begin
  if upper(btrim(coalesce(p_provider,''))) not in ('GITHUB','DRIVE','SUPABASE','CORE')
    or p_provider_request_hash !~ '^sha256:[0-9a-f]{64}$'
    or p_provider_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
    or p_result_binding_hash !~ '^sha256:[0-9a-f]{64}$'
    or p_authority_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_fencing_generation,0)<1
    or coalesce(jsonb_typeof(p_receipt_metadata),'null')<>'object' then
    return jsonb_build_object('decision','BLOCKED_RECEIPT_BINDING_INVALID');
  end if;
  if public.ceo_core_jsonb_has_sensitive_key_v1(p_receipt_metadata) then
    return jsonb_build_object('decision','BLOCKED_SECRET_OR_RAW_PII');
  end if;

  select * into v_action from public.ceo_core_guarded_action_ledger where action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ACTION_NOT_FOUND'); end if;
  if v_action.state='COMPLETED' then
    return jsonb_build_object('decision','DUPLICATE_NOOP_TERMINAL','state','COMPLETED','action_id',p_action_id,
      'result_binding_hash',v_action.result_binding_hash);
  end if;
  if v_action.target_provider<>upper(btrim(p_provider)) or v_action.authority_receipt_hash<>p_authority_receipt_hash
    or v_action.fencing_generation<>p_fencing_generation then
    return jsonb_build_object('decision','BLOCKED_RECEIPT_ACTION_AUTHORITY_MISMATCH');
  end if;

  select * into v_attempt from public.ceo_core_guarded_action_attempts where attempt_id=p_attempt_id and action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ATTEMPT_NOT_FOUND'); end if;
  if v_attempt.authority_receipt_hash<>p_authority_receipt_hash or v_attempt.fencing_generation<>p_fencing_generation then
    return jsonb_build_object('decision','BLOCKED_RECEIPT_ATTEMPT_AUTHORITY_MISMATCH');
  end if;

  select receipt_id into v_receipt_id from public.ceo_core_guarded_action_receipts
   where provider_receipt_hash=p_provider_receipt_hash;
  if found then
    return jsonb_build_object('decision','DUPLICATE_NOOP_RECEIPT','receipt_id',v_receipt_id,'action_id',p_action_id);
  end if;

  insert into public.ceo_core_guarded_action_receipts(
    action_id,attempt_id,provider,provider_operation_id,provider_request_hash,provider_receipt_hash,
    result_binding_hash,authority_receipt_hash,fencing_generation,receipt_metadata
  ) values (
    p_action_id,p_attempt_id,upper(btrim(p_provider)),btrim(p_provider_operation_id),p_provider_request_hash,p_provider_receipt_hash,
    p_result_binding_hash,p_authority_receipt_hash,p_fencing_generation,p_receipt_metadata
  ) returning receipt_id into v_receipt_id;

  update public.ceo_core_guarded_action_attempts set outcome='RECEIPT_VERIFIED',provider_operation_id=btrim(p_provider_operation_id),
    provider_request_hash=p_provider_request_hash,failure_code=null,finished_at=now() where attempt_id=p_attempt_id;
  update public.ceo_core_guarded_action_ledger set state='COMPLETED',result_binding_hash=p_result_binding_hash,
    failure_code=null,completed_at=now(),updated_at=now() where action_id=p_action_id;

  return jsonb_build_object('decision','ACTION_COMPLETED_VERIFIED','action_id',p_action_id,'attempt_id',p_attempt_id,
    'receipt_id',v_receipt_id,'state','COMPLETED','result_binding_hash',p_result_binding_hash);
end;$function$;

create or replace function public.ceo_core_mark_guarded_action_reconciliation_v1(
  p_action_id uuid,
  p_status text,
  p_result_binding_hash text default null
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_action public.ceo_core_guarded_action_ledger%rowtype;
begin
  select * into v_action from public.ceo_core_guarded_action_ledger where action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ACTION_NOT_FOUND'); end if;
  if v_action.state not in ('RECEIPT_PENDING','RECONCILING') then
    return jsonb_build_object('decision','BLOCKED_RECONCILIATION_STATE_INVALID','state',v_action.state);
  end if;
  if v_status='NOT_APPLIED_VERIFIED' then
    update public.ceo_core_guarded_action_ledger set state='FAILED_RETRYABLE',updated_at=now(),failure_code='RECONCILED_NOT_APPLIED'
      where action_id=p_action_id;
    return jsonb_build_object('decision','SAFE_TO_REPREPARE_OR_RETRY','state','FAILED_RETRYABLE','action_id',p_action_id);
  elsif v_status='STILL_UNKNOWN' then
    update public.ceo_core_guarded_action_ledger set state='RECEIPT_PENDING',updated_at=now() where action_id=p_action_id;
    return jsonb_build_object('decision','KEEP_RECEIPT_PENDING_NO_REDISPATCH','state','RECEIPT_PENDING','action_id',p_action_id);
  elsif v_status='APPLIED_VERIFIED' then
    if p_result_binding_hash !~ '^sha256:[0-9a-f]{64}$' then
      return jsonb_build_object('decision','BLOCKED_RESULT_BINDING_HASH_INVALID');
    end if;
    -- Completion still requires a provider receipt via ceo_core_finalize_guarded_action_v1.
    update public.ceo_core_guarded_action_ledger set state='RECEIPT_PENDING',result_binding_hash=p_result_binding_hash,
      updated_at=now(),failure_code='RECONCILED_APPLIED_RECEIPT_REQUIRED' where action_id=p_action_id;
    return jsonb_build_object('decision','APPLIED_VERIFIED_RECEIPT_STILL_REQUIRED','state','RECEIPT_PENDING','action_id',p_action_id);
  end if;
  return jsonb_build_object('decision','BLOCKED_RECONCILIATION_STATUS_INVALID');
end;$function$;

create or replace function public.ceo_core_get_guarded_action_status_v1(p_action_id uuid)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object(
    'action_id',a.action_id,'work_identity_binding_hash',a.work_identity_binding_hash,'action_type',a.action_type,
    'risk_class',a.risk_class,'target_provider',a.target_provider,'state',a.state,'attempt_count',a.attempt_count,
    'prepared_action_hash',a.prepared_action_hash,'authority_receipt_hash',a.authority_receipt_hash,
    'fencing_generation',a.fencing_generation,'fresh_source_binding_hash',a.fresh_source_binding_hash,
    'result_binding_hash',a.result_binding_hash,'failure_code',a.failure_code,'prepared_at',a.prepared_at,
    'updated_at',a.updated_at,'completed_at',a.completed_at,
    'verified_receipt_required_for_completion',true,
    'blind_redispatch_allowed',false
  ) from public.ceo_core_guarded_action_ledger a where a.action_id=p_action_id;
$function$;

revoke all on table public.ceo_core_guarded_action_ledger from public,anon,authenticated;
revoke all on table public.ceo_core_guarded_action_attempts from public,anon,authenticated;
revoke all on table public.ceo_core_guarded_action_receipts from public,anon,authenticated;
revoke execute on function public.ceo_core_prepare_guarded_action_v1(text,text,text,bigint,text,text,text,jsonb,text,jsonb,text) from public,anon,authenticated;
revoke execute on function public.ceo_core_claim_guarded_action_execution_v1(uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
revoke execute on function public.ceo_core_record_guarded_action_provider_result_v1(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.ceo_core_finalize_guarded_action_v1(uuid,uuid,text,text,text,text,text,text,bigint,jsonb) from public,anon,authenticated;
revoke execute on function public.ceo_core_mark_guarded_action_reconciliation_v1(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.ceo_core_get_guarded_action_status_v1(uuid) from public,anon,authenticated;

grant execute on function public.ceo_core_prepare_guarded_action_v1(text,text,text,bigint,text,text,text,jsonb,text,jsonb,text) to service_role;
grant execute on function public.ceo_core_claim_guarded_action_execution_v1(uuid,text,text,text,bigint,text,text) to service_role;
grant execute on function public.ceo_core_record_guarded_action_provider_result_v1(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.ceo_core_finalize_guarded_action_v1(uuid,uuid,text,text,text,text,text,text,bigint,jsonb) to service_role;
grant execute on function public.ceo_core_mark_guarded_action_reconciliation_v1(uuid,text,text) to service_role;
grant execute on function public.ceo_core_get_guarded_action_status_v1(uuid) to service_role;

create or replace function public.ceo_core_get_guarded_action_dispatch_v1(p_action_id uuid)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object(
    'action_id',a.action_id,'context_lease_id',a.context_lease_id,
    'work_identity_binding_hash',a.work_identity_binding_hash,'adapter_instance_id',a.adapter_instance_id,
    'adapter_epoch',a.adapter_epoch,'action_type',a.action_type,'risk_class',a.risk_class,
    'target_provider',a.target_provider,'intent',a.intent,'intent_hash',a.intent_hash,
    'idempotency_key',a.idempotency_key,'owned_paths',a.owned_paths,'owned_paths_hash',a.owned_paths_hash,
    'expected_parent_head',a.expected_parent_head,'prepared_action_hash',a.prepared_action_hash,
    'state',a.state,'authority_receipt_hash',a.authority_receipt_hash,'writer_lease_id',a.writer_lease_id,
    'fencing_generation',a.fencing_generation,'fresh_source_binding_hash',a.fresh_source_binding_hash,
    'policy_revision',a.policy_revision,'attempt_count',a.attempt_count,'last_attempt_id',a.last_attempt_id
  ) from public.ceo_core_guarded_action_ledger a where a.action_id=p_action_id;
$function$;

revoke execute on function public.ceo_core_get_guarded_action_dispatch_v1(uuid) from public,anon,authenticated;
grant execute on function public.ceo_core_get_guarded_action_dispatch_v1(uuid) to service_role;

create or replace function public.ceo_core_begin_guarded_action_reconciliation_v1(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_action public.ceo_core_guarded_action_ledger%rowtype;
begin
  select * into v_action from public.ceo_core_guarded_action_ledger where action_id=p_action_id for update;
  if not found then return jsonb_build_object('decision','BLOCKED_ACTION_NOT_FOUND'); end if;
  if v_action.state='COMPLETED' then return jsonb_build_object('decision','DUPLICATE_NOOP_TERMINAL','state','COMPLETED'); end if;
  if v_action.state='RECONCILING' then return jsonb_build_object('decision','DUPLICATE_NOOP_RECONCILIATION_IN_PROGRESS','state','RECONCILING'); end if;
  if v_action.state<>'RECEIPT_PENDING' then
    return jsonb_build_object('decision','BLOCKED_RECONCILIATION_STATE_INVALID','state',v_action.state);
  end if;
  update public.ceo_core_guarded_action_ledger set state='RECONCILING',updated_at=now() where action_id=p_action_id;
  return jsonb_build_object('decision','RECONCILIATION_CLAIMED','action_id',p_action_id,'state','RECONCILING',
    'last_attempt_id',v_action.last_attempt_id,'target_provider',v_action.target_provider);
end;$function$;

revoke execute on function public.ceo_core_begin_guarded_action_reconciliation_v1(uuid) from public,anon,authenticated;
grant execute on function public.ceo_core_begin_guarded_action_reconciliation_v1(uuid) to service_role;

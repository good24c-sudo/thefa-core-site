create table public.core_console_invites_v2 (
  email text primary key check (email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  approved_at timestamptz not null default now()
);
alter table public.core_console_invites_v2 enable row level security;
revoke all on public.core_console_invites_v2 from public, anon, authenticated, service_role;
grant select on public.core_console_invites_v2 to service_role;
insert into public.core_console_invites_v2(email) values ('thefa@thefa.kr'),('ceo@thefa.kr');

alter table public.core_console_email_challenges_v2 drop constraint core_console_email_challenges_v2_email_check;
alter table public.core_console_sessions_v2 drop constraint core_console_sessions_v2_email_check;
alter table public.core_console_email_challenges_v2 add constraint core_console_email_challenges_v2_invite_fkey foreign key(email) references public.core_console_invites_v2(email);
alter table public.core_console_sessions_v2 add constraint core_console_sessions_v2_invite_fkey foreign key(email) references public.core_console_invites_v2(email);

create or replace function public.core_console_request_code_v2(p_email text,p_challenge_id uuid,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.core_console_email_challenges_v2;
begin
  if p_email is null or not exists(select 1 from public.core_console_invites_v2 where email=p_email) then raise exception 'EMAIL_NOT_ALLOWED'; end if;
  insert into public.core_console_email_challenges_v2(email,id,code_hash,expires_at,last_sent_at)
    values(p_email,p_challenge_id,p_code_hash,clock_timestamp()+interval '10 minutes',clock_timestamp())
    on conflict(email) do update set id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,used_at=null,last_sent_at=excluded.last_sent_at
    where core_console_email_challenges_v2.last_sent_at <= clock_timestamp()-interval '60 seconds'
    returning * into r;
  if not found then return jsonb_build_object('accepted',false,'retryAfter',60); end if;
  return jsonb_build_object('accepted',true,'challengeId',r.id,'expiresIn',600);
end $$;

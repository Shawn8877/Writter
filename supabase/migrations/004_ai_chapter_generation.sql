-- Phase 3C_0: bounded generation, protected preview, atomic confirmation.
begin;
alter table public.ai_generation_logs
  add column generation_type text not null default 'novel_builder' check(generation_type in ('novel_builder','chapter_generation')),
  add column provider text not null default 'deepseek',
  add column novel_id uuid references public.novels(id) on delete set null,
  add column chapter_id uuid references public.chapters(id) on delete set null,
  add column novel_revision bigint,
  add column chapter_revision bigint;
update public.ai_generation_logs set provider=case when model like 'gpt-%' then 'openai' when model like 'deepseek%' then 'deepseek' else 'test_fixture' end;
grant select(generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision) on public.ai_generation_logs to authenticated;

-- Prose is kept outside metadata logs; only a valid server lease can write it.
create table public.ai_chapter_previews (
  generation_id uuid primary key references public.ai_generation_logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  content text not null check(octet_length(content) between 1 and 120000),
  version_id uuid references public.chapter_versions(id) on delete set null,
  confirmed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.ai_chapter_previews enable row level security;
create policy chapter_preview_owner_read on public.ai_chapter_previews for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_chapter_previews from public,anon,authenticated;
grant select on public.ai_chapter_previews to authenticated;

create function public.studio_begin_chapter_generation(p_request_id uuid,p_lease_token uuid,p_input_hash text,p_model text,p_novel_id uuid,p_chapter_id uuid,p_novel_revision bigint,p_chapter_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); generation_id uuid; n public.novels; c public.chapters; begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_request_id is null or p_lease_token is null or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into n from public.novels where id=p_novel_id and user_id=owner_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=p_chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if n.revision is distinct from p_novel_revision or c.revision is distinct from p_chapter_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  if c.content<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and request_id=p_request_id) then raise exception 'DUPLICATE_REQUEST' using errcode='PT409'; end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=6 then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,p_request_id,p_lease_token,p_input_hash,p_model,'chapter-writer-v1','chapter_generation','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_id;
  return generation_id;
end $$;

create function public.studio_finish_chapter_generation(p_generation_id uuid,p_lease_token uuid,p_status text,p_model text,p_input_tokens integer,p_output_tokens integer,p_latency_ms integer,p_provider_request_id text,p_error_type text,p_content text)
returns boolean language plpgsql security definer set search_path='' as $$
declare g public.ai_generation_logs; begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  select * into g from public.ai_generation_logs where id=p_generation_id and user_id=auth.uid() and lease_token=p_lease_token and status='running' and generation_type='chapter_generation' for update;
  if not found then return false; end if;
  if p_status='succeeded' and (p_content is null or btrim(p_content)='' or octet_length(p_content)>120000) then raise exception 'INVALID_OUTPUT' using errcode='22023'; end if;
  if not public.studio_finish_ai_generation(p_generation_id,p_lease_token,p_status,p_model,p_input_tokens,p_output_tokens,p_latency_ms,p_provider_request_id,p_error_type) then return false; end if;
  if p_status='succeeded' then
    insert into public.ai_chapter_previews(generation_id,user_id,novel_id,chapter_id,content) values(g.id,g.user_id,g.novel_id,g.chapter_id,p_content);
  end if;
  return true;
end $$;

-- Explicit ownership checks complement table RLS. Locks use the same
-- novel -> chapter order as manual saves. Retry never overwrites later edits.
create function public.studio_confirm_chapter_generation(p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.ai_generation_logs; p public.ai_chapter_previews; n public.novels; c public.chapters; version_uuid uuid; begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  select * into g from public.ai_generation_logs where id=p_generation_id and user_id=auth.uid() and generation_type='chapter_generation' and status='succeeded';
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into n from public.novels where id=g.novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=g.chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into p from public.ai_chapter_previews where generation_id=g.id and user_id=auth.uid() and novel_id=n.id and chapter_id=c.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p.confirmed_at is not null then return jsonb_build_object('chapter',to_jsonb(c),'novelRevision',n.revision,'versionId',p.version_id,'replayed',true); end if;
  if c.content<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
  if c.revision<>g.chapter_revision or n.revision<>g.novel_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  update public.chapters set content=p.content,status='generated' where id=c.id and novel_id=n.id returning * into c;
  insert into public.chapter_versions(chapter_id,content,source) values(c.id,c.content,'ai_generated') returning id into version_uuid;
  update public.ai_chapter_previews set version_id=version_uuid,confirmed_at=clock_timestamp() where generation_id=g.id;
  select * into n from public.novels where id=n.id;
  return jsonb_build_object('chapter',to_jsonb(c),'novelRevision',n.revision,'versionId',version_uuid,'replayed',false);
end $$;
revoke all on function public.studio_begin_chapter_generation(uuid,uuid,text,text,uuid,uuid,bigint,bigint),public.studio_finish_chapter_generation(uuid,uuid,text,text,integer,integer,integer,text,text,text),public.studio_confirm_chapter_generation(uuid) from public,anon;
grant execute on function public.studio_begin_chapter_generation(uuid,uuid,text,text,uuid,uuid,bigint,bigint),public.studio_finish_chapter_generation(uuid,uuid,text,text,integer,integer,integer,text,text,text),public.studio_confirm_chapter_generation(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

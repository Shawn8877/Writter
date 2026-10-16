-- Phase 3C_2: one durable writing run per novel, with one independently
-- confirmed AI version and memory job per chapter.
begin;

-- Existing, author-saved outlines count as approved. AI outlines enter this
-- column only through an explicit preview confirmation.
alter table public.chapters add column outline_approved_at timestamptz;
update public.chapters set outline_approved_at=updated_at where btrim(outline)<>'';
create function public.studio_approve_saved_outline() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or new.outline is distinct from old.outline then
    new.outline_approved_at=case when btrim(new.outline)<>'' then clock_timestamp() else null end;
  end if;
  return new;
end $$;
create trigger approve_saved_outline before insert or update of outline on public.chapters
  for each row execute function public.studio_approve_saved_outline();

create unique index chapters_novel_positive_number_unique on public.chapters(novel_id,sort_order) where sort_order>0;

alter table public.ai_generation_logs drop constraint ai_generation_logs_generation_type_check;
alter table public.ai_generation_logs add constraint ai_generation_logs_generation_type_check
  check(generation_type in ('novel_builder','chapter_generation','chapter_memory_analysis','chapter_outline_generation'));

create table public.ai_outline_previews (
  generation_id uuid primary key references public.ai_generation_logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_number integer not null check(chapter_number>0),
  title text not null check(char_length(title) between 1 and 100),
  outline text not null check(octet_length(outline) between 40 and 30000),
  confirmed_chapter_id uuid references public.chapters(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.ai_outline_previews enable row level security;
create policy outline_preview_owner_read on public.ai_outline_previews for select to authenticated
  using(user_id=(select auth.uid()));
revoke all on public.ai_outline_previews from public,anon,authenticated;
grant select on public.ai_outline_previews to authenticated;

create function public.studio_begin_outline_generation(p_request_id uuid,p_lease_token uuid,p_input_hash text,p_model text,p_novel_id uuid,p_chapter_number integer,p_novel_revision bigint,p_chapter_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); n public.novels; c public.chapters; generation_id uuid; last_written integer;
begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_request_id is null or p_lease_token is null or p_input_hash !~ '^[a-f0-9]{64}$' or char_length(p_model) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into n from public.novels where id=p_novel_id and user_id=owner_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(max(sort_order),0) into last_written from public.chapters where novel_id=n.id and btrim(content)<>'';
  if p_chapter_number<=last_written or p_chapter_number>last_written+10 or n.revision is distinct from p_novel_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  select * into c from public.chapters where novel_id=n.id and sort_order=p_chapter_number for update;
  if (found and (btrim(c.content)<>'' or btrim(c.outline)<>'' or c.revision is distinct from p_chapter_revision)) or (not found and p_chapter_revision is not null) then
    raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  if exists(select 1 from public.generation_runs where novel_id=n.id and status in ('pending','running','paused','failed')) then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and request_id=p_request_id) then raise exception 'DUPLICATE_REQUEST' using errcode='PT409'; end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=6 then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,p_request_id,p_lease_token,p_input_hash,p_model,'chapter-outline-v1','chapter_outline_generation','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_id;
  return generation_id;
end $$;

create function public.studio_finish_outline_generation(p_generation_id uuid,p_lease_token uuid,p_status text,p_model text,p_input_tokens integer,p_output_tokens integer,p_latency_ms integer,p_provider_request_id text,p_error_type text,p_chapter_number integer,p_title text,p_outline text)
returns boolean language plpgsql security definer set search_path='' as $$
declare g public.ai_generation_logs;
begin
  select * into g from public.ai_generation_logs where id=p_generation_id and user_id=auth.uid() and lease_token=p_lease_token and status='running' and generation_type='chapter_outline_generation' for update;
  if not found then return false; end if;
  if p_status='succeeded' and (char_length(p_title) not between 1 and 100 or octet_length(p_outline) not between 40 and 30000 or p_chapter_number<1) then
    raise exception 'INVALID_OUTPUT' using errcode='22023'; end if;
  if not public.studio_finish_ai_generation(p_generation_id,p_lease_token,p_status,p_model,p_input_tokens,p_output_tokens,p_latency_ms,p_provider_request_id,p_error_type) then return false; end if;
  if p_status='succeeded' then
    insert into public.ai_outline_previews(generation_id,user_id,novel_id,chapter_number,title,outline)
      values(g.id,g.user_id,g.novel_id,p_chapter_number,p_title,p_outline);
  end if;
  return true;
end $$;

create function public.studio_confirm_outline_generation(p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.ai_generation_logs; p public.ai_outline_previews; n public.novels; c public.chapters; volume_uuid uuid;
begin
  select * into g from public.ai_generation_logs where id=p_generation_id and user_id=auth.uid() and status='succeeded' and generation_type='chapter_outline_generation';
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into n from public.novels where id=g.novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into p from public.ai_outline_previews where generation_id=g.id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p.confirmed_at is not null then
    select * into c from public.chapters where id=p.confirmed_chapter_id;
    return jsonb_build_object('chapter',to_jsonb(c),'replayed',true);
  end if;
  if n.revision<>g.novel_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  select * into c from public.chapters where novel_id=n.id and sort_order=p.chapter_number for update;
  if found then
    if btrim(c.content)<>'' or btrim(c.outline)<>'' or c.revision is distinct from g.chapter_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
    update public.chapters set title=p.title,outline=p.outline where id=c.id returning * into c;
  else
    if g.chapter_id is not null then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
    select id into volume_uuid from public.volumes where novel_id=n.id and sort_order>0 order by sort_order desc limit 1;
    insert into public.chapters(novel_id,volume_id,title,outline,sort_order) values(n.id,volume_uuid,p.title,p.outline,p.chapter_number) returning * into c;
  end if;
  update public.ai_outline_previews set confirmed_chapter_id=c.id,confirmed_at=clock_timestamp() where generation_id=p.generation_id;
  return jsonb_build_object('chapter',to_jsonb(c),'replayed',false);
end $$;

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  novel_id uuid not null references public.novels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check(mode in ('next','continuous')),
  start_chapter integer not null check(start_chapter>0),
  target_chapters integer not null check(target_chapters between 1 and 10),
  current_index integer not null default 0 check(current_index between 0 and 10),
  status text not null default 'pending' check(status in ('pending','running','paused','completed','failed','cancelled')),
  stage text not null default 'ready' check(stage in ('ready','generating','preview','saving','analyzing','completed')),
  lease_token uuid,
  lease_at timestamptz,
  cancel_requested boolean not null default false,
  error_type text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(novel_id,id)
);
create unique index generation_runs_one_active on public.generation_runs(novel_id)
  where status in ('pending','running','paused','failed');
create index generation_runs_owner_recent on public.generation_runs(user_id,novel_id,created_at desc);

create table public.generation_run_chapters (
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  novel_id uuid not null,
  chapter_id uuid not null,
  chapter_number integer not null,
  position integer not null check(position between 0 and 9),
  request_id uuid,
  generation_id uuid references public.ai_generation_logs(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','generating','generated','analyzing','completed','failed')),
  error_type text,
  updated_at timestamptz not null default now(),
  primary key(run_id,position),
  unique(run_id,chapter_number),
  foreign key(novel_id,chapter_id) references public.chapters(novel_id,id) on delete cascade,
  foreign key(novel_id,run_id) references public.generation_runs(novel_id,id) on delete cascade
);
create index generation_run_chapters_chapter on public.generation_run_chapters(chapter_id);

alter table public.generation_runs enable row level security;
alter table public.generation_run_chapters enable row level security;
create policy generation_run_owner_read on public.generation_runs for select to authenticated
  using(user_id=(select auth.uid()));
create policy generation_run_chapter_owner_read on public.generation_run_chapters for select to authenticated
  using(exists(select 1 from public.generation_runs r where r.id=run_id and r.user_id=(select auth.uid())));
revoke all on public.generation_runs,public.generation_run_chapters from public,anon,authenticated;
grant select on public.generation_runs,public.generation_run_chapters to authenticated;

create function public.studio_start_generation_run(p_novel_id uuid,p_count integer,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.novels; existing public.generation_runs; start_number integer; missing integer[]:='{}'; blocked integer[]:='{}'; idx integer; c public.chapters; run_id uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_count not in (1,3,5,10) or (p_mode='next' and p_count<>1) or (p_mode='continuous' and p_count=1) or p_mode not in ('next','continuous') then
    raise exception 'INVALID_COUNT' using errcode='22023';
  end if;
  select * into n from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into existing from public.generation_runs where novel_id=n.id and status in ('pending','running','paused','failed') order by created_at desc limit 1;
  if found then return jsonb_build_object('runId',existing.id,'existing',true,'status',existing.status); end if;
  select coalesce(max(sort_order),0)+1 into start_number from public.chapters where novel_id=n.id and btrim(content)<>'';
  if start_number+p_count-1>10000 then raise exception 'INVALID_COUNT' using errcode='22023'; end if;
  if exists(select 1 from public.chapters where novel_id=n.id and sort_order<start_number and btrim(content)='') then
    raise exception 'EARLIER_CHAPTER_EMPTY' using errcode='PT409';
  end if;
  if not exists(select 1 from public.novel_bible where novel_id=n.id and (btrim(core_premise)<>'' or btrim(synopsis)<>'' or btrim(main_conflict)<>'')) then
    raise exception 'BIBLE_REQUIRED' using errcode='PT409';
  end if;
  if not exists(select 1 from public.characters where novel_id=n.id) then raise exception 'CHARACTERS_REQUIRED' using errcode='PT409'; end if;
  if exists(select 1 from public.chapter_memory_jobs where novel_id=n.id and status in ('pending','running','failed','stale','needs_review')) then
    raise exception 'MEMORY_NOT_READY' using errcode='PT409';
  end if;
  for idx in 0..p_count-1 loop
    select * into c from public.chapters where novel_id=n.id and sort_order=start_number+idx;
    if not found or btrim(c.outline)='' or c.outline_approved_at is null then missing:=array_append(missing,start_number+idx);
    elsif btrim(c.content)<>'' then blocked:=array_append(blocked,start_number+idx); end if;
    if found and exists(select 1 from public.ai_generation_logs g where g.chapter_id=c.id and g.status='running') then
      raise exception 'AI_BUSY' using errcode='PT409';
    end if;
  end loop;
  if cardinality(blocked)>0 then return jsonb_build_object('status','blocked','existingContent',to_jsonb(blocked),'startChapter',start_number); end if;
  if cardinality(missing)>0 then return jsonb_build_object('status','outlines_required','missingOutlines',to_jsonb(missing),'startChapter',start_number); end if;
  insert into public.generation_runs(novel_id,user_id,mode,start_chapter,target_chapters,status)
    values(n.id,auth.uid(),p_mode,start_number,p_count,'running') returning id into run_id;
  insert into public.generation_run_chapters(run_id,novel_id,chapter_id,chapter_number,position)
    select run_id,n.id,planned.id,planned.sort_order,planned.sort_order-start_number from public.chapters planned
    where planned.novel_id=n.id and planned.sort_order>=start_number and planned.sort_order<start_number+p_count;
  return jsonb_build_object('runId',run_id,'existing',false,'status','running','startChapter',start_number);
end $$;

-- Preserve the existing preview API while making a run the sole writer for
-- its target. Other novels and ordinary single-chapter generation are intact.
create or replace function public.studio_begin_chapter_generation(p_request_id uuid,p_lease_token uuid,p_input_hash text,p_model text,p_novel_id uuid,p_chapter_id uuid,p_novel_revision bigint,p_chapter_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); generation_id uuid; n public.novels; c public.chapters; hourly_limit integer;
begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_request_id is null or p_lease_token is null or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into n from public.novels where id=p_novel_id and user_id=owner_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=p_chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if n.revision is distinct from p_novel_revision or c.revision is distinct from p_chapter_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  if c.content<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
  if exists(select 1 from public.generation_run_chapters item join public.generation_runs r on r.id=item.run_id
    where item.chapter_id=c.id and r.status in ('pending','running','paused') and item.request_id is distinct from p_request_id) then
    raise exception 'AI_BUSY' using errcode='PT409';
  end if;
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and request_id=p_request_id) then raise exception 'DUPLICATE_REQUEST' using errcode='PT409'; end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  hourly_limit:=case when exists(select 1 from public.generation_run_chapters item join public.generation_runs r on r.id=item.run_id
    where item.chapter_id=c.id and item.request_id=p_request_id and r.status='running' and r.mode='continuous') then 24 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,p_request_id,p_lease_token,p_input_hash,p_model,'chapter-writer-v1','chapter_generation','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_id;
  return generation_id;
end $$;

-- A user explicitly confirmed at most ten chapters before a continuous run.
-- Keep the six-call/hour limit for ordinary AI actions; allow at most 24
-- writer/memory calls in that confirmed run so 5/10 chapters can finish.
create or replace function public.studio_begin_chapter_memory(p_novel_id uuid,p_chapter_id uuid,p_novel_revision bigint,p_chapter_revision bigint,p_lease_token uuid,p_model text,p_input_hash text,p_retry boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); n public.novels; c public.chapters; j public.chapter_memory_jobs; generation_uuid uuid; hourly_limit integer;
begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_lease_token is null or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' or p_model is null or char_length(p_model) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into n from public.novels where id=p_novel_id and user_id=owner_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=p_chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if btrim(c.content)='' then raise exception 'CONTENT_REQUIRED' using errcode='22023'; end if;
  if n.revision is distinct from p_novel_revision or c.revision is distinct from p_chapter_revision then raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  insert into public.chapter_memory_jobs(chapter_id,novel_id,content_hash) values(c.id,n.id,md5(c.content)) on conflict(chapter_id) do nothing;
  select * into j from public.chapter_memory_jobs where chapter_id=c.id for update;
  if j.status='succeeded' and j.content_hash=md5(c.content) then return jsonb_build_object('status','succeeded','generationId',j.generation_id,'started',false); end if;
  if j.status='running' and exists(select 1 from public.ai_generation_logs where id=j.generation_id and status='running' and created_at>clock_timestamp()-interval '5 minutes') then return jsonb_build_object('status','running','started',false); end if;
  if j.status<>'pending' and p_retry is distinct from true then return jsonb_build_object('status',j.status,'started',false); end if;
  if exists(select 1 from public.chapter_memory_jobs later join public.chapters lc on lc.id=later.chapter_id where later.novel_id=n.id and later.status='succeeded' and lc.sort_order>c.sort_order) then raise exception 'LATER_MEMORY_EXISTS' using errcode='PT409'; end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  hourly_limit:=case when exists(select 1 from public.generation_run_chapters item join public.generation_runs r on r.id=item.run_id
    where item.chapter_id=c.id and r.status='running' and r.mode='continuous' and r.stage='analyzing') then 24 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,gen_random_uuid(),p_lease_token,p_input_hash,p_model,'chapter-memory-v1','chapter_memory_analysis','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_uuid;
  update public.chapter_memory_jobs set status='running',generation_id=generation_uuid,content_hash=md5(c.content),error_type=null,updated_at=clock_timestamp() where chapter_id=c.id;
  return jsonb_build_object('status','running','generationId',generation_uuid,'started',true);
end $$;

-- A lease makes two browsers claiming the same step idempotent. Each call
-- schedules at most one model request; no transaction spans a provider call.
create function public.studio_claim_generation_step(p_run_id uuid,p_lease_token uuid,p_request_id uuid,p_manual_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters; action text;
begin
  if p_lease_token is null or p_request_id is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or r.cancel_requested then return jsonb_build_object('action','wait','status',r.status); end if;
  if r.lease_token is not null then return jsonb_build_object('action','wait','status',r.status); end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  if not found then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id for update;
  if r.stage='ready' then
    if btrim(c.content)<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
    if btrim(c.outline)='' or c.outline_approved_at is null then raise exception 'OUTLINE_REQUIRED' using errcode='PT409'; end if;
    if r.current_index>0 and not exists(select 1 from public.chapter_memory_jobs j join public.generation_run_chapters prior on prior.chapter_id=j.chapter_id
      where prior.run_id=r.id and prior.position=r.current_index-1 and j.status='succeeded') then
      raise exception 'MEMORY_NOT_READY' using errcode='PT409';
    end if;
    action:='generate';
    update public.generation_run_chapters set status='generating',request_id=p_request_id,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set stage='generating',lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  elsif r.stage='preview' and (r.mode='continuous' or p_manual_approve is true) then
    action:='confirm';
    update public.generation_runs set stage='saving',lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  elsif r.stage='analyzing' then
    action:='memory';
    update public.generation_runs set lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  else return jsonb_build_object('action','wait','status',r.status); end if;
  return jsonb_build_object('action',action,'runId',r.id,'chapterId',item.chapter_id,'chapterNumber',item.chapter_number,
    'requestId',coalesce(item.request_id,p_request_id),'generationId',item.generation_id,'leaseToken',p_lease_token,'novelId',r.novel_id,'chapterRevision',c.revision);
end $$;

create function public.studio_reconcile_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; g public.ai_generation_logs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or r.lease_token is null or r.lease_at>clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('status',r.status,'stage',r.stage);
  end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  if r.stage='generating' then
    select * into g from public.ai_generation_logs where user_id=r.user_id and request_id=item.request_id;
    if g.status='succeeded' and exists(select 1 from public.ai_chapter_previews where generation_id=g.id and chapter_id=item.chapter_id) then
      update public.generation_run_chapters set status='generated',generation_id=g.id,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
      update public.generation_runs set stage='preview',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','preview');
    end if;
  elsif r.stage='saving' then
    if exists(select 1 from public.ai_chapter_previews where generation_id=item.generation_id and chapter_id=item.chapter_id and confirmed_at is not null and version_id is not null) then
      update public.generation_run_chapters set status='analyzing',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
      update public.generation_runs set stage='analyzing',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','analyzing');
    end if;
    update public.generation_runs set stage='preview',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('status','running','stage','preview');
  elsif r.stage='analyzing' then
    if exists(select 1 from public.chapter_memory_jobs where chapter_id=item.chapter_id and status='succeeded') then
      update public.generation_runs set lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','analyzing');
    end if;
  end if;
  update public.generation_run_chapters set status='failed',error_type='LEASE_EXPIRED',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
  update public.generation_runs set status='failed',error_type='LEASE_EXPIRED',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','failed','stage',r.stage);
end $$;

create function public.studio_finish_generation_step(p_run_id uuid,p_lease_token uuid,p_action text,p_generation_id uuid,p_error_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters; j public.chapter_memory_jobs; next_status text;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.lease_token is distinct from p_lease_token then return jsonb_build_object('status',r.status,'ignored',true); end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id;
  if p_action='generated' and r.stage='generating' then
    if not exists(select 1 from public.ai_chapter_previews p join public.ai_generation_logs g on g.id=p.generation_id
      where p.generation_id=p_generation_id and p.chapter_id=c.id and p.user_id=r.user_id and g.status='succeeded' and g.request_id=item.request_id) then
      raise exception 'PREVIEW_REQUIRED' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='generated',generation_id=p_generation_id,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set stage='preview',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  elsif p_action='confirmed' and r.stage='saving' then
    if not exists(select 1 from public.ai_chapter_previews p where p.generation_id=item.generation_id and p.chapter_id=c.id and p.confirmed_at is not null and p.version_id is not null) then
      raise exception 'VERSION_REQUIRED' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='analyzing',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set stage='analyzing',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  elsif p_action='memory_succeeded' and r.stage='analyzing' then
    select * into j from public.chapter_memory_jobs where chapter_id=c.id and novel_id=r.novel_id;
    if j.status<>'succeeded' or not exists(select 1 from public.chapter_summaries where chapter_id=c.id and analysis_version_id=j.version_id) then
      raise exception 'MEMORY_NOT_READY' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='completed',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    next_status:=case when r.cancel_requested then 'cancelled' when r.current_index+1=r.target_chapters then 'completed' else 'running' end;
    update public.generation_runs set status=next_status,stage=case when next_status='completed' then 'completed' else 'ready' end,
      current_index=current_index+1,lease_token=null,lease_at=null,updated_at=clock_timestamp(),
      completed_at=case when next_status in ('completed','cancelled') then clock_timestamp() else null end where id=r.id;
  elsif p_action='failed' then
    update public.generation_run_chapters set status='failed',error_type=left(coalesce(p_error_type,'REQUEST_FAILED'),100),updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set status=case when cancel_requested then 'cancelled' else 'failed' end,
      error_type=left(coalesce(p_error_type,'REQUEST_FAILED'),100),lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  else raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  return jsonb_build_object('status',(select status from public.generation_runs where id=r.id));
end $$;

create function public.studio_cancel_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status in ('completed','cancelled') then return jsonb_build_object('status',r.status); end if;
  update public.generation_runs set cancel_requested=true,status='cancelled',updated_at=clock_timestamp(),completed_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','cancelled');
end $$;

create function public.studio_pause_generation_run(p_run_id uuid,p_error_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or r.stage<>'ready' or r.lease_token is not null then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  update public.generation_runs set status='paused',error_type=left(coalesce(p_error_type,'CONSISTENCY_REVIEW'),100),updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','paused');
end $$;

create function public.studio_retry_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status not in ('failed','paused') then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id;
  if btrim(c.content)<>'' then
    if not exists(select 1 from public.ai_chapter_previews p where p.generation_id=item.generation_id and p.confirmed_at is not null) then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
    update public.generation_runs set status='running',stage='analyzing',error_type=null,updated_at=clock_timestamp() where id=r.id;
  elsif item.generation_id is not null and exists(select 1 from public.ai_chapter_previews where generation_id=item.generation_id) then
    update public.generation_runs set status='running',stage='preview',error_type=null,updated_at=clock_timestamp() where id=r.id;
  else
    if btrim(c.outline)='' or c.outline_approved_at is null then raise exception 'OUTLINE_REQUIRED' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='pending',error_type=null,request_id=null,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set status='running',stage='ready',error_type=null,updated_at=clock_timestamp() where id=r.id;
  end if;
  return jsonb_build_object('status','running');
end $$;

revoke all on function public.studio_begin_outline_generation(uuid,uuid,text,text,uuid,integer,bigint,bigint),
  public.studio_finish_outline_generation(uuid,uuid,text,text,integer,integer,integer,text,text,integer,text,text),public.studio_confirm_outline_generation(uuid),
  public.studio_start_generation_run(uuid,integer,text),public.studio_claim_generation_step(uuid,uuid,uuid,boolean),public.studio_reconcile_generation_run(uuid),
  public.studio_finish_generation_step(uuid,uuid,text,uuid,text),public.studio_cancel_generation_run(uuid),public.studio_pause_generation_run(uuid,text),public.studio_retry_generation_run(uuid) from public,anon;
grant execute on function public.studio_begin_outline_generation(uuid,uuid,text,text,uuid,integer,bigint,bigint),
  public.studio_finish_outline_generation(uuid,uuid,text,text,integer,integer,integer,text,text,integer,text,text),public.studio_confirm_outline_generation(uuid),
  public.studio_start_generation_run(uuid,integer,text),public.studio_claim_generation_step(uuid,uuid,uuid,boolean),public.studio_reconcile_generation_run(uuid),
  public.studio_finish_generation_step(uuid,uuid,text,uuid,text),public.studio_cancel_generation_run(uuid),public.studio_pause_generation_run(uuid,text),public.studio_retry_generation_run(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

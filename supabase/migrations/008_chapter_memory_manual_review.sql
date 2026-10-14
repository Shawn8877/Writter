-- Re-analysis is append-only. Changed analysed prose needs an explicit human
-- continuity review instead of silently retaining facts from an older version.
begin;
alter table public.chapter_memory_jobs drop constraint chapter_memory_jobs_status_check;
alter table public.chapter_memory_jobs add constraint chapter_memory_jobs_status_check
  check(status in ('pending','running','succeeded','failed','stale','needs_review','reviewed'));
alter table public.chapter_memory_jobs add column reviewed_at timestamptz,
  add column reviewed_revision bigint;

create or replace function public.studio_stale_chapter_memory() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.content is distinct from old.content then
    update public.chapter_memory_jobs j set
      status=case when j.status in ('needs_review','reviewed') or exists(
        select 1 from public.chapter_summaries s where s.chapter_id=new.id and s.analysis_content_hash is not null
      ) then 'needs_review' when j.status='running' then 'running' else 'stale' end,
      error_type=case when j.status in ('needs_review','reviewed') or exists(
        select 1 from public.chapter_summaries s where s.chapter_id=new.id and s.analysis_content_hash is not null
      ) then 'MEMORY_REVIEW_REQUIRED' else j.error_type end,
      version_id=null,reviewed_at=null,reviewed_revision=null,updated_at=clock_timestamp()
      where j.chapter_id=new.id;
  end if;
  return new;
end $$;

-- Include pre-migration failed/stale re-analyses and the previous historical
-- chapter dead end. The original AI summary hash remains an honest provenance.
update public.chapter_memory_jobs j set status='needs_review',error_type='MEMORY_REVIEW_REQUIRED',
  version_id=null,updated_at=clock_timestamp()
  where j.error_type='LATER_MEMORY_EXISTS' or exists(
    select 1 from public.chapter_summaries s join public.chapters c on c.id=s.chapter_id
    where s.chapter_id=j.chapter_id and s.analysis_content_hash is not null
      and (j.status<>'succeeded' or j.content_hash<>md5(c.content) or s.analysis_content_hash<>md5(c.content))
  );

create or replace function public.studio_begin_chapter_memory(p_novel_id uuid,p_chapter_id uuid,p_novel_revision bigint,p_chapter_revision bigint,p_lease_token uuid,p_model text,p_input_hash text,p_retry boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); n public.novels; c public.chapters; j public.chapter_memory_jobs; generation_uuid uuid; begin
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
  if j.status in ('succeeded','reviewed') and j.content_hash=md5(c.content) then
    return jsonb_build_object('status',j.status,'generationId',j.generation_id,'started',false);
  end if;
  if j.status in ('needs_review','reviewed') or exists(
    select 1 from public.chapter_summaries where chapter_id=c.id and analysis_content_hash is not null
  ) or exists(
    select 1 from public.chapter_memory_jobs later join public.chapters lc on lc.id=later.chapter_id
    where later.novel_id=n.id and later.status in ('succeeded','reviewed') and lc.sort_order>c.sort_order
  ) then
    update public.chapter_memory_jobs set status='needs_review',error_type='MEMORY_REVIEW_REQUIRED',
      version_id=null,reviewed_at=null,reviewed_revision=null,updated_at=clock_timestamp() where chapter_id=c.id;
    return jsonb_build_object('status','needs_review','errorType','MEMORY_REVIEW_REQUIRED','chapterRevision',c.revision,'started',false);
  end if;
  if j.status='running' and exists(select 1 from public.ai_generation_logs where id=j.generation_id and status='running' and created_at>clock_timestamp()-interval '5 minutes') then return jsonb_build_object('status','running','started',false); end if;
  if j.status<>'pending' and p_retry is distinct from true then return jsonb_build_object('status',j.status,'started',false); end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=6 then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,gen_random_uuid(),p_lease_token,p_input_hash,p_model,'chapter-memory-v1','chapter_memory_analysis','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_uuid;
  update public.chapter_memory_jobs set status='running',generation_id=generation_uuid,content_hash=md5(c.content),error_type=null,updated_at=clock_timestamp() where chapter_id=c.id;
  return jsonb_build_object('status','running','generationId',generation_uuid,'started',true);
end $$;

-- Only an explicit, current-revision human acknowledgement can lift this guard.
-- This neither calls AI nor rewrites the original analysis hash or its evidence.
create function public.studio_acknowledge_chapter_memory(p_novel_id uuid,p_chapter_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.novels; c public.chapters; j public.chapter_memory_jobs; reviewed_time timestamptz; begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  select * into n from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=p_chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_revision is null or c.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  select * into j from public.chapter_memory_jobs where chapter_id=c.id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if j.status<>'needs_review' then raise exception 'MEMORY_REVIEW_NOT_REQUIRED' using errcode='PT409'; end if;
  -- A pre-migration callback might still be finishing. Its lease is revoked
  -- within the same locks so it cannot overwrite the user's reviewed state.
  update public.ai_generation_logs set status='failed',error_type='MEMORY_REVIEW_REQUIRED',completed_at=clock_timestamp()
    where id=j.generation_id and user_id=auth.uid() and generation_type='chapter_memory_analysis' and status='running';
  reviewed_time:=clock_timestamp();
  update public.chapter_memory_jobs set status='reviewed',content_hash=md5(c.content),error_type=null,
    version_id=null,reviewed_at=reviewed_time,reviewed_revision=c.revision,updated_at=reviewed_time where chapter_id=c.id;
  return jsonb_build_object('status','reviewed','chapterRevision',c.revision,'updatedAt',reviewed_time);
end $$;

revoke all on function public.studio_acknowledge_chapter_memory(uuid,uuid,bigint) from public,anon;
grant execute on function public.studio_acknowledge_chapter_memory(uuid,uuid,bigint) to authenticated;

-- The finishing RPC is replaced below so a callback started before this
-- migration cannot bypass the review guard or change reviewed back to failed.

create or replace function public.studio_finish_chapter_memory(p_generation_id uuid,p_lease_token uuid,p_result jsonb,p_error_type text,p_metrics jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.ai_generation_logs; n public.novels; c public.chapters; j public.chapter_memory_jobs; item jsonb; found_id uuid; problem text:=p_error_type; final_status text; begin
  select * into g from public.ai_generation_logs where id=p_generation_id and user_id=auth.uid() and lease_token=p_lease_token and status='running' and generation_type='chapter_memory_analysis';
  if not found then raise exception 'LEASE_EXPIRED' using errcode='PT409'; end if;
  select * into n from public.novels where id=g.novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=g.chapter_id and novel_id=n.id for update;
  select * into j from public.chapter_memory_jobs where chapter_id=c.id and generation_id=g.id for update;
  if not found then raise exception 'LEASE_EXPIRED' using errcode='PT409'; end if;
  select * into g from public.ai_generation_logs where id=g.id and lease_token=p_lease_token and status='running' for update;
  if not found then raise exception 'LEASE_EXPIRED' using errcode='PT409'; end if;
  if j.status in ('needs_review','reviewed') then problem:='MEMORY_REVIEW_REQUIRED'; end if;
  if problem is null and (n.revision<>g.novel_revision or c.revision<>g.chapter_revision or md5(c.content)<>j.content_hash) then problem:='CONTEXT_CHANGED'; end if;
  if problem is null then
    if p_result is null or octet_length(p_result::text)>150000 or char_length(p_result->>'chapterSummary') not between 100 and 300 then raise exception 'INVALID_OUTPUT' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_result->'characters') loop
      if item->>'id' is null then
        -- New identities have only chapter-confirmed fields; base-persona fields stay untouched.
        insert into public.characters(novel_id,name,role,description,first_appearance_chapter_id,current_state,relationships,abilities,is_alive)
          values(n.id,item->>'name',item->>'role',item->>'description',c.id,item->'current_state',item->'relationships',item->'abilities',coalesce((item->>'is_alive')::boolean,true));
      else
        update public.characters set current_state=item->'current_state',relationships=item->'relationships',abilities=item->'abilities',is_alive=coalesce((item->>'is_alive')::boolean,is_alive) where id=(item->>'id')::uuid and novel_id=n.id;
        if not found then raise exception 'INVALID_CHARACTER' using errcode='22023'; end if;
      end if;
    end loop;
    for item in select value from jsonb_array_elements(p_result->'memories') loop
      if item->>'id' is null then
        insert into public.memory_items(novel_id,chapter_id,memory_type,title,content,importance,status,source_type,source_id,metadata)
          values(n.id,c.id,item->>'memory_type',item->>'title',item->>'content',(item->>'importance')::integer,item->>'status','chapter',c.id,item->'metadata');
      else
        update public.memory_items set chapter_id=c.id,content=item->>'content',importance=(item->>'importance')::integer,status=item->>'status',source_type='chapter',source_id=c.id,metadata=item->'metadata'
          where id=(item->>'id')::uuid and novel_id=n.id and memory_type=item->>'memory_type';
        if not found then raise exception 'INVALID_MEMORY' using errcode='22023'; end if;
      end if;
    end loop;
    for item in select value from jsonb_array_elements(p_result->'timelineEvents') loop
      select id into found_id from public.timeline_events where novel_id=n.id and chapter_id=c.id and title=item->>'title' order by created_at limit 1;
      if found_id is null then
        insert into public.timeline_events(novel_id,chapter_id,title,description,importance,event_time,kind,sort_order)
          values(n.id,c.id,item->>'title',item->>'description',(item->>'importance')::integer,item->>'eventTime','已发生',c.sort_order);
      else
        update public.timeline_events set description=item->>'description',importance=(item->>'importance')::integer,event_time=item->>'eventTime' where id=found_id and novel_id=n.id;
      end if;
    end loop;
    insert into public.chapter_summaries(chapter_id,novel_id,summary,key_events,character_changes,new_information,foreshadowing_added,foreshadowing_resolved,next_chapter_requirements,analysis_content_hash,analysis_version_id)
      values(c.id,n.id,p_result->>'chapterSummary',p_result->'keyEvents',p_result->'characterChanges',p_result->'newInformation',p_result->'foreshadowingAdded',p_result->'foreshadowingResolved',p_result->'nextChapterRequirements',j.content_hash,j.version_id)
      on conflict(chapter_id) do update set summary=excluded.summary,key_events=excluded.key_events,character_changes=excluded.character_changes,new_information=excluded.new_information,foreshadowing_added=excluded.foreshadowing_added,foreshadowing_resolved=excluded.foreshadowing_resolved,next_chapter_requirements=excluded.next_chapter_requirements,analysis_content_hash=excluded.analysis_content_hash,analysis_version_id=excluded.analysis_version_id;
  end if;
  if not public.studio_finish_ai_generation(g.id,p_lease_token,case when problem is null then 'succeeded' else 'failed' end,coalesce(p_metrics->>'model',g.model),(p_metrics->>'inputTokens')::integer,(p_metrics->>'outputTokens')::integer,(p_metrics->>'latencyMs')::integer,p_metrics->>'providerRequestId',problem) then raise exception 'LEASE_EXPIRED' using errcode='PT409'; end if;
  final_status:=case when j.status in ('needs_review','reviewed') then j.status when problem is null then 'succeeded' else 'failed' end;
  update public.chapter_memory_jobs set status=final_status,
    error_type=case when final_status='reviewed' then null else left(problem,100) end,
    updated_at=case when final_status='reviewed' then updated_at else clock_timestamp() end where chapter_id=c.id;
  return jsonb_build_object('status',final_status,'errorType',case when final_status='reviewed' then null else problem end);
end $$;

notify pgrst, 'reload schema';
commit;

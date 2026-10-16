-- Preserve Phase 3C_1's manual-review guard while allowing a user-confirmed,
-- bounded continuous run to consume the writer + analysis calls it needs.
begin;
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
  hourly_limit:=case when exists(select 1 from public.generation_run_chapters item join public.generation_runs r on r.id=item.run_id
    where item.chapter_id=c.id and r.status='running' and r.mode='continuous' and r.stage='analyzing') then 24 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,gen_random_uuid(),p_lease_token,p_input_hash,p_model,'chapter-memory-v1','chapter_memory_analysis','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_uuid;
  update public.chapter_memory_jobs set status='running',generation_id=generation_uuid,content_hash=md5(c.content),error_type=null,updated_at=clock_timestamp() where chapter_id=c.id;
  return jsonb_build_object('status','running','generationId',generation_uuid,'started',true);
end $$;
notify pgrst, 'reload schema';
commit;

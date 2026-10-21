-- Phase 3D. Review is advisory: it never mutates chapter content or novel memory.
begin;

alter table public.ai_generation_logs drop constraint ai_generation_logs_generation_type_check;
alter table public.ai_generation_logs add constraint ai_generation_logs_generation_type_check
  check (generation_type in ('novel_builder','chapter_generation','chapter_memory_analysis','chapter_outline_generation','chapter_review'));
alter table public.ai_generation_logs add column chapter_version_id uuid references public.chapter_versions(id) on delete set null;
alter table public.ai_generation_logs add column generation_run_id uuid references public.generation_runs(id) on delete set null;
grant select(chapter_version_id,generation_run_id) on public.ai_generation_logs to authenticated;
alter table public.generation_runs drop constraint generation_runs_stage_check;
alter table public.generation_runs add constraint generation_runs_stage_check
  check (stage in ('ready','generating','preview','saving','analyzing','reviewing','completed'));
alter table public.generation_run_chapters drop constraint generation_run_chapters_status_check;
alter table public.generation_run_chapters add constraint generation_run_chapters_status_check
  check (status in ('pending','generating','generated','analyzing','reviewing','completed','failed'));
alter table public.generation_run_chapters add column review_retry boolean not null default false;

create table public.chapter_reviews (
  id uuid primary key default gen_random_uuid(),
  novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_id uuid not null,
  chapter_version_id uuid references public.chapter_versions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  generation_id uuid references public.ai_generation_logs(id) on delete set null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{32}$'),
  chapter_revision bigint not null,
  novel_revision bigint not null,
  status text not null default 'running' check (status in ('running','passed','needs_review','critical','failed','stale')),
  overall_score integer check (overall_score between 0 and 100),
  summary text,
  result_json jsonb,
  model text not null,
  prompt_version text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_type text,
  manual boolean not null default false,
  attempt_count integer not null default 1 check(attempt_count between 1 and 2),
  author_acknowledged boolean not null default false,
  author_acknowledged_at timestamptz,
  lease_token uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(novel_id,id),
  foreign key (novel_id,chapter_id) references public.chapters(novel_id,id) on delete cascade
);
create index chapter_reviews_chapter_recent on public.chapter_reviews(chapter_id,created_at desc);
create unique index chapter_reviews_one_auto on public.chapter_reviews(chapter_id,content_hash) where manual=false;
alter table public.chapter_reviews enable row level security;
create policy chapter_reviews_owner_read on public.chapter_reviews for select to authenticated
  using (user_id=(select auth.uid()) and exists(select 1 from public.novels n where n.id=novel_id and n.user_id=(select auth.uid())));
revoke all on public.chapter_reviews from public,anon,authenticated;
grant select(id,novel_id,chapter_id,chapter_version_id,user_id,generation_run_id,content_hash,chapter_revision,status,overall_score,summary,result_json,model,prompt_version,input_tokens,output_tokens,latency_ms,error_type,manual,author_acknowledged,author_acknowledged_at,created_at,updated_at) on public.chapter_reviews to authenticated;

create function public.studio_begin_chapter_review(
  p_novel_id uuid,p_chapter_id uuid,p_chapter_version_id uuid,p_chapter_revision bigint,p_content_hash text,
  p_lease_token uuid,p_model text,p_prompt_version text,p_manual boolean,p_generation_run_id uuid,p_novel_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); n public.novels; c public.chapters; existing public.chapter_reviews;
  review_uuid uuid; generation_uuid uuid; hourly_limit integer;
begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_lease_token is null or p_content_hash !~ '^[a-f0-9]{32}$' or p_model is null or char_length(p_model) not between 1 and 120
    or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into n from public.novels where id=p_novel_id and user_id=owner_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into c from public.chapters where id=p_chapter_id and novel_id=n.id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if btrim(c.content)='' or c.revision is distinct from p_chapter_revision or n.revision is distinct from p_novel_revision or md5(c.content)<>p_content_hash then
    raise exception 'CONTEXT_CHANGED' using errcode='PT409'; end if;
  if p_chapter_version_id is not null and not exists(select 1 from public.chapter_versions v where v.id=p_chapter_version_id and v.chapter_id=c.id and v.content=c.content) then
    raise exception 'VERSION_NOT_FOUND' using errcode='PT409'; end if;
  if p_generation_run_id is not null and not exists(select 1 from public.generation_runs r join public.generation_run_chapters item on item.run_id=r.id
    where r.id=p_generation_run_id and r.user_id=owner_id and item.chapter_id=c.id and r.stage='reviewing' and r.status='running') then
    raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  if p_manual is distinct from true then
    select * into existing from public.chapter_reviews where chapter_id=c.id and content_hash=p_content_hash and manual=false for update;
    if found then
      if existing.status='running' and existing.updated_at<clock_timestamp()-interval '5 minutes' then
        update public.chapter_reviews set status='failed',error_type='LEASE_EXPIRED',lease_token=null,updated_at=clock_timestamp() where id=existing.id;
        update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp() where id=existing.generation_id and status='running';
        return jsonb_build_object('status','failed','errorType','LEASE_EXPIRED','started',false,'reviewId',existing.id);
      else return jsonb_build_object('status',existing.status,'started',false,'reviewId',existing.id); end if;
    end if;
  end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp()
    where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  hourly_limit:=case when p_generation_run_id is not null and exists(select 1 from public.generation_runs r where r.id=p_generation_run_id and r.mode='continuous') then 36 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,chapter_version_id,generation_run_id,novel_revision,chapter_revision)
    values(owner_id,gen_random_uuid(),p_lease_token,p_content_hash,p_model,p_prompt_version,'chapter_review','deepseek',n.id,c.id,p_chapter_version_id,p_generation_run_id,n.revision,c.revision)
    returning id into generation_uuid;
  if found and existing.id is not null and p_manual is distinct from true then
    update public.chapter_reviews set status='running',generation_id=generation_uuid,lease_token=p_lease_token,error_type=null,updated_at=clock_timestamp() where id=existing.id returning id into review_uuid;
  else
    insert into public.chapter_reviews(novel_id,chapter_id,chapter_version_id,user_id,generation_run_id,generation_id,content_hash,chapter_revision,novel_revision,model,prompt_version,manual,lease_token)
      values(n.id,c.id,p_chapter_version_id,owner_id,p_generation_run_id,generation_uuid,p_content_hash,c.revision,n.revision,p_model,p_prompt_version,coalesce(p_manual,false),p_lease_token)
      returning id into review_uuid;
  end if;
  return jsonb_build_object('status','running','started',true,'reviewId',review_uuid);
end $$;

create function public.studio_finish_chapter_review(p_review_id uuid,p_lease_token uuid,p_result jsonb,p_error_type text,p_metrics jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.chapter_reviews; c public.chapters; review_status text;
begin
  select * into r from public.chapter_reviews where id=p_review_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or r.lease_token is distinct from p_lease_token then return jsonb_build_object('status',r.status,'reviewId',r.id,'started',false); end if;
  select * into c from public.chapters where id=r.chapter_id and novel_id=r.novel_id;
  if p_result is not null and c.revision=r.chapter_revision and md5(c.content)=r.content_hash and exists(select 1 from public.novels where id=r.novel_id and revision=r.novel_revision) then
    review_status:=p_result->>'status';
    if review_status not in ('passed','needs_review','critical') or (p_result->>'overallScore') !~ '^[0-9]{1,3}$'
      or (p_result->>'overallScore')::integer>100 or jsonb_typeof(p_result->'findings')<>'array' then raise exception 'INVALID_REVIEW' using errcode='22023'; end if;
  elsif p_result is not null then review_status:='stale';
  else review_status:='failed'; end if;
  update public.chapter_reviews set status=review_status,overall_score=case when review_status in ('passed','needs_review','critical') then (p_result->>'overallScore')::integer else null end,
    summary=case when review_status in ('passed','needs_review','critical') then left(p_result->>'summary',1000) else null end,
    result_json=case when review_status in ('passed','needs_review','critical') then p_result else null end,
    input_tokens=greatest(0,nullif(p_metrics->>'inputTokens','')::integer),output_tokens=greatest(0,nullif(p_metrics->>'outputTokens','')::integer),
    latency_ms=greatest(0,nullif(p_metrics->>'latencyMs','')::integer),error_type=case when review_status='failed' then left(coalesce(p_error_type,'REVIEW_FAILED'),100) when review_status='stale' then 'CONTEXT_CHANGED' else null end,
    updated_at=clock_timestamp() where id=r.id;
  update public.ai_generation_logs set status=case when review_status in ('passed','needs_review','critical') then 'succeeded' else 'failed' end,
    input_tokens=greatest(0,nullif(p_metrics->>'inputTokens','')::integer),output_tokens=greatest(0,nullif(p_metrics->>'outputTokens','')::integer),
    latency_ms=greatest(0,nullif(p_metrics->>'latencyMs','')::integer),provider_request_id=left(p_metrics->>'providerRequestId',200),
    error_type=case when review_status='failed' then left(coalesce(p_error_type,'REVIEW_FAILED'),100) when review_status='stale' then 'CONTEXT_CHANGED' else null end,
    completed_at=clock_timestamp() where id=r.generation_id and status='running';
  return jsonb_build_object('status',review_status,'reviewId',r.id,'started',false);
end $$;

-- Only the worker holding the opaque lease may perform one automatic retry.
create function public.studio_retry_chapter_review(p_review_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.chapter_reviews; g public.ai_generation_logs; new_log uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  select * into r from public.chapter_reviews where id=p_review_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'failed' or r.attempt_count>=2 or r.lease_token is distinct from p_lease_token then return jsonb_build_object('started',false); end if;
  if not exists(select 1 from public.chapters c join public.novels n on n.id=c.novel_id where c.id=r.chapter_id and c.revision=r.chapter_revision and md5(c.content)=r.content_hash and n.revision=r.novel_revision) then return jsonb_build_object('started',false); end if;
  if exists(select 1 from public.ai_generation_logs where user_id=auth.uid() and status='running') then return jsonb_build_object('started',false); end if;
  if (select count(*) from public.ai_generation_logs where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour') >= (case when r.generation_run_id is null then 6 else 36 end) then return jsonb_build_object('started',false); end if;
  select * into g from public.ai_generation_logs where id=r.generation_id;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,chapter_version_id,generation_run_id,novel_revision,chapter_revision)
    values(r.user_id,gen_random_uuid(),p_lease_token,g.input_hash,r.model,r.prompt_version,'chapter_review','deepseek',r.novel_id,r.chapter_id,r.chapter_version_id,r.generation_run_id,g.novel_revision,r.chapter_revision) returning id into new_log;
  update public.chapter_reviews set status='running',attempt_count=attempt_count+1,generation_id=new_log,error_type=null,updated_at=clock_timestamp() where id=r.id;
  update public.generation_runs set lease_at=clock_timestamp() where id=r.generation_run_id and stage='reviewing' and status='running';
  return jsonb_build_object('started',true);
end $$;
revoke all on function public.studio_retry_chapter_review(uuid,uuid) from public,anon;
grant execute on function public.studio_retry_chapter_review(uuid,uuid) to authenticated;

create function public.studio_decide_review_finding(p_review_id uuid,p_finding_index integer,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.chapter_reviews; decisions jsonb; key text;
begin
  select * into r from public.chapter_reviews where id=p_review_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_decision not in ('accepted','ignored','acknowledged') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_decision='acknowledged' then
    if r.status<>'critical' then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
    update public.chapter_reviews set author_acknowledged=true,author_acknowledged_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('acknowledged',true);
  end if;
  if r.status not in ('passed','needs_review','critical') or p_finding_index<0 or p_finding_index>=jsonb_array_length(r.result_json->'findings') then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  key:=p_finding_index::text;
  decisions:=coalesce(r.result_json->'authorDecisions','{}'::jsonb);
  update public.chapter_reviews set result_json=jsonb_set(r.result_json,'{authorDecisions}',decisions||jsonb_build_object(key,p_decision)),updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('decision',p_decision,'findingIndex',p_finding_index);
end $$;

revoke all on function public.studio_begin_chapter_review(uuid,uuid,uuid,bigint,text,uuid,text,text,boolean,uuid,bigint),
  public.studio_finish_chapter_review(uuid,uuid,jsonb,text,jsonb),public.studio_decide_review_finding(uuid,integer,text) from public,anon;
grant execute on function public.studio_begin_chapter_review(uuid,uuid,uuid,bigint,text,uuid,text,text,boolean,uuid,bigint),
  public.studio_finish_chapter_review(uuid,uuid,jsonb,text,jsonb),public.studio_decide_review_finding(uuid,integer,text) to authenticated;

-- The run functions below are replaced by the reviewer-aware state machine.

create or replace function public.studio_claim_generation_step(p_run_id uuid,p_lease_token uuid,p_request_id uuid,p_manual_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters; action text;
begin
  if p_lease_token is null or p_request_id is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or (r.cancel_requested and r.stage not in ('analyzing','reviewing')) then return jsonb_build_object('action','wait','status',r.status); end if;
  if r.lease_token is not null then return jsonb_build_object('action','wait','status',r.status); end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  if not found then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id for update;
  if r.stage='ready' then
    if btrim(c.content)<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
    if btrim(c.outline)='' or c.outline_approved_at is null then raise exception 'OUTLINE_REQUIRED' using errcode='PT409'; end if;
    if r.current_index>0 and not exists(select 1 from public.generation_run_chapters prior join public.chapter_memory_jobs j on j.chapter_id=prior.chapter_id
      where prior.run_id=r.id and prior.position=r.current_index-1 and j.status in ('succeeded','reviewed')) then
      raise exception 'MEMORY_NOT_READY' using errcode='PT409'; end if;
    action:='generate';
    update public.generation_run_chapters set status='generating',request_id=p_request_id,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set stage='generating',lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  elsif r.stage='preview' and (r.mode='continuous' or p_manual_approve is true) then
    action:='confirm';
    update public.generation_runs set stage='saving',lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  elsif r.stage='analyzing' then
    action:='memory';
    update public.generation_runs set lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  elsif r.stage='reviewing' then
    action:='review';
    update public.generation_run_chapters set review_retry=false where run_id=r.id and position=r.current_index;
    update public.generation_runs set lease_token=p_lease_token,lease_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  else return jsonb_build_object('action','wait','status',r.status); end if;
  return jsonb_build_object('action',action,'runId',r.id,'chapterId',item.chapter_id,'chapterNumber',item.chapter_number,
    'requestId',coalesce(item.request_id,p_request_id),'generationId',item.generation_id,'leaseToken',p_lease_token,'novelId',r.novel_id,'chapterRevision',c.revision,'manualReview',item.review_retry);
end $$;

create or replace function public.studio_finish_generation_step(p_run_id uuid,p_lease_token uuid,p_action text,p_generation_id uuid,p_error_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters; j public.chapter_memory_jobs; review public.chapter_reviews; next_status text;
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
    update public.generation_run_chapters set status='reviewing',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set stage='reviewing',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  elsif p_action='review_succeeded' and r.stage='reviewing' then
    select * into review from public.chapter_reviews where chapter_id=c.id and generation_run_id=r.id and content_hash=md5(c.content)
      and status in ('passed','needs_review','critical') order by created_at desc limit 1;
    if not found then raise exception 'REVIEW_NOT_READY' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='completed',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    next_status:=case when r.cancel_requested then 'cancelled' when review.status='critical' then 'paused'
      when r.current_index+1=r.target_chapters then 'completed' else 'running' end;
    update public.generation_runs set status=next_status,stage=case when next_status='completed' then 'completed' else 'ready' end,
      error_type=case when next_status='paused' then 'REVIEW_CRITICAL' else null end,
      current_index=current_index+1,lease_token=null,lease_at=null,updated_at=clock_timestamp(),
      completed_at=case when next_status in ('completed','cancelled') then clock_timestamp() else null end where id=r.id;
  elsif p_action='failed' then
    update public.generation_run_chapters set status='failed',error_type=left(coalesce(p_error_type,'REQUEST_FAILED'),100),updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set status=case when cancel_requested then 'cancelled' else 'failed' end,
      error_type=left(coalesce(p_error_type,'REQUEST_FAILED'),100),lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  else raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  return jsonb_build_object('status',(select status from public.generation_runs where id=r.id));
end $$;

create function public.studio_continue_critical_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; previous_item public.generation_run_chapters; review public.chapter_reviews;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'paused' or r.error_type<>'REVIEW_CRITICAL' or r.current_index<1 then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into previous_item from public.generation_run_chapters where run_id=r.id and position=r.current_index-1;
  select * into review from public.chapter_reviews where chapter_id=previous_item.chapter_id and generation_run_id=r.id and status='critical'
    order by created_at desc limit 1 for update;
  if not found then raise exception 'REVIEW_NOT_READY' using errcode='PT409'; end if;
  update public.chapter_reviews set author_acknowledged=true,author_acknowledged_at=clock_timestamp(),updated_at=clock_timestamp() where id=review.id;
  update public.generation_runs set status=case when current_index>=target_chapters then 'completed' else 'running' end,
    stage=case when current_index>=target_chapters then 'completed' else 'ready' end,error_type=null,
    completed_at=case when current_index>=target_chapters then clock_timestamp() else null end,updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status',(select status from public.generation_runs where id=r.id),'reviewId',review.id,'authorOverride',true);
end $$;

revoke all on function public.studio_continue_critical_run(uuid) from public,anon;
grant execute on function public.studio_continue_critical_run(uuid) to authenticated;

create or replace function public.studio_reconcile_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; g public.ai_generation_logs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or r.lease_token is null or r.lease_at>clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('status',r.status,'stage',r.stage); end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  if r.stage='generating' then
    select * into g from public.ai_generation_logs where user_id=r.user_id and request_id=item.request_id;
    if g.status='succeeded' and exists(select 1 from public.ai_chapter_previews where generation_id=g.id and chapter_id=item.chapter_id) then
      update public.generation_run_chapters set status='generated',generation_id=g.id,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
      update public.generation_runs set stage='preview',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','preview'); end if;
  elsif r.stage='saving' then
    if exists(select 1 from public.ai_chapter_previews where generation_id=item.generation_id and chapter_id=item.chapter_id and confirmed_at is not null and version_id is not null) then
      update public.generation_run_chapters set status='analyzing',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
      update public.generation_runs set stage='analyzing',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','analyzing'); end if;
    update public.generation_runs set stage='preview',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('status','running','stage','preview');
  elsif r.stage='analyzing' then
    if exists(select 1 from public.chapter_memory_jobs where chapter_id=item.chapter_id and status='succeeded') then
      update public.generation_runs set lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','analyzing'); end if;
  elsif r.stage='reviewing' then
    if exists(select 1 from public.chapter_reviews where chapter_id=item.chapter_id and generation_run_id=r.id and status in ('passed','needs_review','critical')) then
      update public.generation_runs set lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
      return jsonb_build_object('status','running','stage','reviewing'); end if;
  end if;
  update public.generation_run_chapters set status='failed',error_type='LEASE_EXPIRED',updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
  update public.generation_runs set status='failed',error_type='LEASE_EXPIRED',lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','failed','stage',r.stage);
end $$;

create or replace function public.studio_retry_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status not in ('failed','paused') or r.error_type='REVIEW_CRITICAL' then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id;
  if btrim(c.content)<>'' then
    if not exists(select 1 from public.ai_chapter_previews p where p.generation_id=item.generation_id and p.confirmed_at is not null) then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
    if r.stage='reviewing' or exists(select 1 from public.chapter_memory_jobs where chapter_id=c.id and status='succeeded') then
      update public.generation_run_chapters set status='reviewing',review_retry=true,error_type=null,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
      update public.generation_runs set status='running',stage='reviewing',error_type=null,lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
    else
      update public.generation_runs set status='running',stage='analyzing',error_type=null,lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
    end if;
  elsif item.generation_id is not null and exists(select 1 from public.ai_chapter_previews where generation_id=item.generation_id) then
    update public.generation_runs set status='running',stage='preview',error_type=null,lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  else
    if btrim(c.outline)='' or c.outline_approved_at is null then raise exception 'OUTLINE_REQUIRED' using errcode='PT409'; end if;
    update public.generation_run_chapters set status='pending',error_type=null,request_id=null,updated_at=clock_timestamp() where run_id=r.id and position=r.current_index;
    update public.generation_runs set status='running',stage='ready',error_type=null,lease_token=null,lease_at=null,updated_at=clock_timestamp() where id=r.id;
  end if;
  return jsonb_build_object('status','running');
end $$;

create or replace function public.studio_cancel_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status in ('completed','cancelled') then return jsonb_build_object('status',r.status); end if;
  if r.status='running' and r.stage in ('saving','analyzing','reviewing') then
    update public.generation_runs set cancel_requested=true,updated_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('status','running','cancelRequested',true); end if;
  update public.generation_runs set cancel_requested=true,status='cancelled',updated_at=clock_timestamp(),completed_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','cancelled');
end $$;

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
    where item.chapter_id=c.id and item.request_id=p_request_id and r.status='running' and r.mode='continuous') then 36 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,p_request_id,p_lease_token,p_input_hash,p_model,'chapter-writer-v1','chapter_generation','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_id;
  return generation_id;
end $$;

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
    where item.chapter_id=c.id and r.status='running' and r.mode='continuous' and r.stage='analyzing') then 36 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=hourly_limit then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,novel_revision,chapter_revision)
    values(owner_id,gen_random_uuid(),p_lease_token,p_input_hash,p_model,'chapter-memory-v1','chapter_memory_analysis','deepseek',n.id,c.id,n.revision,c.revision) returning id into generation_uuid;
  update public.chapter_memory_jobs set status='running',generation_id=generation_uuid,content_hash=md5(c.content),error_type=null,updated_at=clock_timestamp() where chapter_id=c.id;
  return jsonb_build_object('status','running','generationId',generation_uuid,'started',true);
end $$;

notify pgrst, 'reload schema';

commit;

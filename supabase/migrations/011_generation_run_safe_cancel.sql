-- Finish memory for a chapter whose confirmation has started before stopping.
begin;
create or replace function public.studio_claim_generation_step(p_run_id uuid,p_lease_token uuid,p_request_id uuid,p_manual_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs; item public.generation_run_chapters; c public.chapters; action text;
begin
  if p_lease_token is null or p_request_id is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'running' or (r.cancel_requested and r.stage<>'analyzing') then return jsonb_build_object('action','wait','status',r.status); end if;
  if r.lease_token is not null then return jsonb_build_object('action','wait','status',r.status); end if;
  select * into item from public.generation_run_chapters where run_id=r.id and position=r.current_index for update;
  if not found then raise exception 'INVALID_STATE' using errcode='PT409'; end if;
  select * into c from public.chapters where id=item.chapter_id and novel_id=r.novel_id for update;
  if r.stage='ready' then
    if btrim(c.content)<>'' then raise exception 'CONTENT_EXISTS' using errcode='PT409'; end if;
    if btrim(c.outline)='' or c.outline_approved_at is null then raise exception 'OUTLINE_REQUIRED' using errcode='PT409'; end if;
    if r.current_index>0 and not exists(select 1 from public.chapter_memory_jobs j join public.generation_run_chapters prior on prior.chapter_id=j.chapter_id
      where prior.run_id=r.id and prior.position=r.current_index-1 and j.status='succeeded') then
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
  else return jsonb_build_object('action','wait','status',r.status); end if;
  return jsonb_build_object('action',action,'runId',r.id,'chapterId',item.chapter_id,'chapterNumber',item.chapter_number,
    'requestId',coalesce(item.request_id,p_request_id),'generationId',item.generation_id,'leaseToken',p_lease_token,'novelId',r.novel_id,'chapterRevision',c.revision);
end $$;

create or replace function public.studio_cancel_generation_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.generation_runs;
begin
  select * into r from public.generation_runs where id=p_run_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status in ('completed','cancelled') then return jsonb_build_object('status',r.status); end if;
  if r.status='running' and r.stage in ('saving','analyzing') then
    update public.generation_runs set cancel_requested=true,updated_at=clock_timestamp() where id=r.id;
    return jsonb_build_object('status','running','cancelRequested',true);
  end if;
  update public.generation_runs set cancel_requested=true,status='cancelled',updated_at=clock_timestamp(),completed_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','cancelled');
end $$;
notify pgrst, 'reload schema';
commit;

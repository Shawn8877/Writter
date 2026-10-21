-- A single-next-chapter run keeps the ordinary hourly limit on review retries.
-- Only explicitly confirmed continuous runs receive the larger allowance.
begin;
create or replace function public.studio_retry_chapter_review(p_review_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.chapter_reviews; g public.ai_generation_logs; new_log uuid; hourly_limit integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  select * into r from public.chapter_reviews where id=p_review_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status<>'failed' or r.attempt_count>=2 or r.lease_token is distinct from p_lease_token then return jsonb_build_object('started',false); end if;
  if not exists(select 1 from public.chapters c join public.novels n on n.id=c.novel_id where c.id=r.chapter_id and c.revision=r.chapter_revision and md5(c.content)=r.content_hash and n.revision=r.novel_revision) then return jsonb_build_object('started',false); end if;
  if exists(select 1 from public.ai_generation_logs where user_id=auth.uid() and status='running') then return jsonb_build_object('started',false); end if;
  hourly_limit:=case when exists(select 1 from public.generation_runs where id=r.generation_run_id and user_id=r.user_id and mode='continuous') then 36 else 6 end;
  if (select count(*) from public.ai_generation_logs where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour') >= hourly_limit then return jsonb_build_object('started',false); end if;
  select * into g from public.ai_generation_logs where id=r.generation_id;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version,generation_type,provider,novel_id,chapter_id,chapter_version_id,generation_run_id,novel_revision,chapter_revision)
    values(r.user_id,gen_random_uuid(),p_lease_token,g.input_hash,r.model,r.prompt_version,'chapter_review','deepseek',r.novel_id,r.chapter_id,r.chapter_version_id,r.generation_run_id,g.novel_revision,r.chapter_revision) returning id into new_log;
  update public.chapter_reviews set status='running',attempt_count=attempt_count+1,generation_id=new_log,error_type=null,updated_at=clock_timestamp() where id=r.id;
  update public.generation_runs set lease_at=clock_timestamp() where id=r.generation_run_id and stage='reviewing' and status='running';
  return jsonb_build_object('started',true);
end $$;
commit;

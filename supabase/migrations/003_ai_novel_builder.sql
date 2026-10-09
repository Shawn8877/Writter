-- Phase 3A. Apply once, after 002. No privileged Supabase key in the app.
begin;

alter table public.novel_bible
  add column story_stages jsonb not null default '[]' check (jsonb_typeof(story_stages)='array'),
  add column builder_metadata jsonb not null default '{}' check (jsonb_typeof(builder_metadata)='object');

-- Metadata only: no prompts, novel plans, API keys or response bodies.
create table public.ai_generation_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, lease_token uuid not null, input_hash text not null,
  model text not null, schema_version text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  input_tokens integer check(input_tokens>=0), output_tokens integer check(output_tokens>=0),
  latency_ms integer check(latency_ms>=0), provider_request_id text, error_type text,
  created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  unique(user_id,request_id), unique(user_id,id)
);
create index ai_generation_owner_time_idx on public.ai_generation_logs(user_id,created_at desc);
create unique index ai_one_running_per_owner on public.ai_generation_logs(user_id) where status='running';
alter table public.ai_generation_logs enable row level security;
create policy ai_generation_owner_read on public.ai_generation_logs for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_generation_logs from public,anon,authenticated;
-- The opaque lease is never readable through REST, including by its owner.
grant select(id,user_id,request_id,input_hash,model,schema_version,status,input_tokens,output_tokens,latency_ms,provider_request_id,error_type,created_at,completed_at) on public.ai_generation_logs to authenticated;

create table public.ai_novel_bundles (
  generation_id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  novel_id uuid references public.novels(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(user_id,generation_id) references public.ai_generation_logs(user_id,id) on delete cascade
);
create index ai_bundle_novel_idx on public.ai_novel_bundles(novel_id);
alter table public.ai_novel_bundles enable row level security;
create policy ai_bundle_owner_read on public.ai_novel_bundles for select to authenticated using(user_id=(select auth.uid()));
create policy ai_bundle_owner_insert on public.ai_novel_bundles for insert to authenticated with check(
  user_id=(select auth.uid()) and exists(select 1 from public.novels n where n.id=novel_id and n.user_id=(select auth.uid()))
  and exists(select 1 from public.ai_generation_logs g where g.id=generation_id and g.user_id=(select auth.uid()) and g.status='succeeded')
);
revoke all on public.ai_novel_bundles from public,anon,authenticated;
grant select,insert on public.ai_novel_bundles to authenticated;

-- Narrow DEFINER functions are necessary to protect rate counters from direct
-- REST writes. Both bind auth.uid(), use a fixed search_path and no dynamic SQL.
create function public.studio_begin_ai_generation(p_request_id uuid,p_lease_token uuid,p_input_hash text,p_model text,p_schema_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); generation_id uuid; begin
  if owner_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_request_id is null or p_lease_token is null or p_input_hash !~ '^[a-f0-9]{64}$' or char_length(p_model) not between 1 and 120 or p_schema_version<>'novel-builder-v1' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  -- Serializes all reservations for this account across workers and tabs.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and request_id=p_request_id) then raise exception 'DUPLICATE_REQUEST' using errcode='PT409'; end if;
  update public.ai_generation_logs set status='failed',error_type='LEASE_EXPIRED',completed_at=clock_timestamp()
    where user_id=owner_id and status='running' and created_at<clock_timestamp()-interval '5 minutes';
  if exists(select 1 from public.ai_generation_logs where user_id=owner_id and status='running') then raise exception 'AI_BUSY' using errcode='PT409'; end if;
  if (select count(*) from public.ai_generation_logs where user_id=owner_id and created_at>clock_timestamp()-interval '1 hour')>=6 then raise exception 'AI_RATE_LIMIT' using errcode='PT429'; end if;
  insert into public.ai_generation_logs(user_id,request_id,lease_token,input_hash,model,schema_version)
    values(owner_id,p_request_id,p_lease_token,p_input_hash,p_model,p_schema_version) returning id into generation_id;
  return generation_id;
end $$;

create function public.studio_finish_ai_generation(p_generation_id uuid,p_lease_token uuid,p_status text,p_model text,p_input_tokens integer,p_output_tokens integer,p_latency_ms integer,p_provider_request_id text,p_error_type text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_status not in ('succeeded','failed') or char_length(p_model)>120 or char_length(p_provider_request_id)>200 or char_length(p_error_type)>80 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  update public.ai_generation_logs set status=p_status,model=coalesce(p_model,model),input_tokens=p_input_tokens,output_tokens=p_output_tokens,latency_ms=p_latency_ms,provider_request_id=p_provider_request_id,error_type=p_error_type,completed_at=clock_timestamp()
    where id=p_generation_id and user_id=auth.uid() and lease_token=p_lease_token and status='running';
  return found;
end $$;

-- All business records still use INVOKER + existing owner RLS. The caller never
-- supplies an owner. An immutable receipt survives novel deletion and retries.
create function public.create_ai_novel_bundle(p_generation_id uuid,p_input_hash text,p_bundle jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare novel_uuid uuid; volume_uuid uuid; receipt public.ai_novel_bundles; n jsonb; b jsonb; stage jsonb; next_chapter integer:=1; stage_number integer:=1;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_generation_id::text,0));
  if not exists(select 1 from public.ai_generation_logs g where g.id=p_generation_id and g.user_id=auth.uid() and g.status='succeeded' and g.input_hash=p_input_hash and g.schema_version='novel-builder-v1') then raise exception 'GENERATION_NOT_FOUND' using errcode='P0002'; end if;
  select * into receipt from public.ai_novel_bundles where generation_id=p_generation_id and user_id=auth.uid();
  if found then
    if receipt.novel_id is null then raise exception 'NOVEL_ALREADY_DELETED' using errcode='PT409'; end if;
    return receipt.novel_id;
  end if;
  if p_bundle is null or octet_length(p_bundle::text)>500000 or jsonb_typeof(p_bundle)<>'object' then raise exception 'INVALID_BUNDLE' using errcode='22023'; end if;
  n=p_bundle->'novel'; b=p_bundle->'bible';
  if n is null or b is null or nullif(btrim(n->>'title'),'') is null or jsonb_typeof(p_bundle->'characters') is distinct from 'array' or jsonb_typeof(p_bundle->'world_entries') is distinct from 'array' or jsonb_typeof(p_bundle->'memory_items') is distinct from 'array' or jsonb_typeof(b->'story_stages') is distinct from 'array' then raise exception 'INVALID_BUNDLE' using errcode='22023'; end if;
  if jsonb_array_length(p_bundle->'characters') not between 6 and 14 or jsonb_array_length(p_bundle->'world_entries') not between 4 and 30 or jsonb_array_length(p_bundle->'memory_items') not between 10 and 30 or jsonb_array_length(b->'story_stages') not between 8 and 12 then raise exception 'INVALID_BUNDLE' using errcode='22023'; end if;
  for stage in select value from jsonb_array_elements(b->'story_stages') loop
    if (stage->>'stageNumber')::integer is distinct from stage_number or (stage->>'approxStartChapter')::integer is distinct from next_chapter or (stage->>'approxEndChapter')::integer<next_chapter then raise exception 'INVALID_STAGES' using errcode='22023'; end if;
    next_chapter=(stage->>'approxEndChapter')::integer+1; stage_number=stage_number+1;
  end loop;
  if next_chapter is distinct from (n->>'target_chapter_count')::integer+1 then raise exception 'INVALID_STAGES' using errcode='22023'; end if;
  insert into public.novels(user_id,title,description,genre,style,premise,protagonist,target_word_count,target_chapter_count,chapter_word_target)
    values(auth.uid(),n->>'title',n->>'description',n->>'genre',n->>'style',n->>'premise',n->>'protagonist',(n->>'target_word_count')::integer,(n->>'target_chapter_count')::integer,(n->>'chapter_word_target')::integer) returning id into novel_uuid;
  insert into public.novel_bible(novel_id,core_premise,world_rules,story_tone,writing_style,protagonist_arc,main_conflict,power_system,romance_direction,ending_direction,forbidden_changes,synopsis,storyline,antagonist,story_stages,builder_metadata)
    values(novel_uuid,b->>'core_premise',b->'world_rules',b->>'story_tone',b->>'writing_style',b->>'protagonist_arc',b->>'main_conflict',b->>'power_system',b->>'romance_direction',b->>'ending_direction',b->'forbidden_changes',b->>'synopsis',b->>'storyline',b->>'antagonist',b->'story_stages',b->'builder_metadata');
  insert into public.characters(novel_id,name,aliases,role,age,gender,description,personality,appearance,background,goals,relationships,abilities,current_state,traits,color)
    select novel_uuid,r.name,r.aliases,r.role,r.age,r.gender,r.description,r.personality,r.appearance,r.background,r.goals,r.relationships,r.abilities,r.current_state,r.traits,r.color
    from jsonb_to_recordset(p_bundle->'characters') as r(name text,aliases jsonb,role text,age text,gender text,description text,personality text,appearance text,background text,goals text,relationships jsonb,abilities jsonb,current_state jsonb,traits jsonb,color text);
  insert into public.world_entries(novel_id,category,name,content,metadata)
    select novel_uuid,r.category,r.name,r.content,r.metadata from jsonb_to_recordset(p_bundle->'world_entries') as r(category text,name text,content text,metadata jsonb);
  insert into public.memory_items(novel_id,memory_type,title,content,importance,source_type,metadata)
    select novel_uuid,r.memory_type,r.title,r.content,r.importance,'ai',jsonb_build_object('generationId',p_generation_id,'schemaVersion','novel-builder-v1','characterNames',r.character_names)
    from jsonb_to_recordset(p_bundle->'memory_items') as r(memory_type text,title text,content text,importance integer,character_names jsonb);
  insert into public.volumes(novel_id,title,sort_order) values(novel_uuid,'第一卷',1) returning id into volume_uuid;
  insert into public.chapters(novel_id,volume_id,title,sort_order,status) values(novel_uuid,volume_uuid,'第一章',1,'planned');
  insert into public.ai_novel_bundles(generation_id,user_id,novel_id) values(p_generation_id,auth.uid(),novel_uuid);
  return novel_uuid;
end $$;

revoke all on function public.studio_begin_ai_generation(uuid,uuid,text,text,text),public.studio_finish_ai_generation(uuid,uuid,text,text,integer,integer,integer,text,text),public.create_ai_novel_bundle(uuid,text,jsonb) from public,anon;
grant execute on function public.studio_begin_ai_generation(uuid,uuid,text,text,text),public.studio_finish_ai_generation(uuid,uuid,text,text,integer,integer,integer,text,text),public.create_ai_novel_bundle(uuid,text,jsonb) to authenticated;
commit;

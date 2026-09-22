-- NovelAI Studio phase 2. Apply as the project database owner.
-- No service role is needed by the application; requests run as the signed-in user.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.novels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名小说', description text not null default '',
  genre text not null default '其他', style text not null default '', premise text not null default '',
  protagonist text not null default '', master_outline text not null default '',
  target_word_count integer not null default 500000 check (target_word_count between 1 and 10000000),
  target_chapter_count integer not null default 200 check (target_chapter_count between 1 and 10000),
  chapter_word_target integer not null default 2500 check (chapter_word_target between 1 and 50000),
  status text not null default 'planning' check (status in ('planning','writing','completed','archived')),
  cover_url text, cover_theme text not null default 'ink', revision bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.volumes (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade,
  title text not null, summary text not null default '', sort_order integer not null default 0,
  chapter_range text not null default '', status text not null default '规划中', beats jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (novel_id,id)
);
create table public.chapters (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade,
  volume_id uuid, title text not null, content text not null default '', outline text not null default '',
  summary text not null default '', word_count integer not null default 0 check (word_count >= 0),
  status text not null default 'planned' check (status in ('planned','draft','generated','reviewed','final')),
  sort_order integer not null default 0, revision bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (novel_id,id),
  foreign key (novel_id,volume_id) references public.volumes(novel_id,id) on delete set null (volume_id)
);
create table public.chapter_versions (
  id uuid primary key default gen_random_uuid(), chapter_id uuid not null references public.chapters(id) on delete cascade,
  content text not null, word_count integer not null default 0 check (word_count >= 0),
  source text not null default 'manual' check (source in ('manual','ai_generated','ai_regenerated','ai_expanded','ai_polished','ai_rewritten')),
  created_at timestamptz not null default now()
);
create table public.characters (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade,
  name text not null, aliases jsonb not null default '[]', role text not null default '重要配角',
  gender text not null default '', age text not null default '', description text not null default '',
  personality text not null default '', appearance text not null default '', background text not null default '', goals text not null default '',
  relationships jsonb not null default '[]', abilities jsonb not null default '[]', current_state jsonb not null default '{}',
  traits jsonb not null default '[]', color text not null default 'gold',
  first_appearance_chapter_id uuid, is_alive boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (novel_id,id),
  foreign key (novel_id,first_appearance_chapter_id) references public.chapters(novel_id,id) on delete set null (first_appearance_chapter_id)
);
create table public.world_entries (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade,
  category text not null default 'other' check (category in ('location','organization','faction','system','rule','item','concept','history','other')),
  name text not null, content text not null default '', metadata jsonb not null default '{}', chapter_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (novel_id,id),
  foreign key (novel_id,chapter_id) references public.chapters(novel_id,id) on delete set null (chapter_id)
);
create table public.timeline_events (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_id uuid, event_time text not null default '', title text not null, description text not null default '',
  characters jsonb not null default '[]', importance integer not null default 3 check (importance between 1 and 5),
  kind text not null default '计划事件', sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (novel_id,chapter_id) references public.chapters(novel_id,id) on delete set null (chapter_id)
);
create table public.novel_bible (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null unique references public.novels(id) on delete cascade,
  core_premise text not null default '', world_rules jsonb not null default '[]', story_tone text not null default '',
  writing_style text not null default '', protagonist_arc text not null default '', main_conflict text not null default '',
  power_system text not null default '', romance_direction text not null default '', ending_direction text not null default '',
  forbidden_changes jsonb not null default '[]', synopsis text not null default '', storyline text not null default '', antagonist text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.chapter_summaries (
  id uuid primary key default gen_random_uuid(), chapter_id uuid not null unique, novel_id uuid not null references public.novels(id) on delete cascade,
  summary text not null default '', key_events jsonb not null default '[]', character_changes jsonb not null default '[]',
  new_information jsonb not null default '[]', foreshadowing_added jsonb not null default '[]', foreshadowing_resolved jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (novel_id,chapter_id) references public.chapters(novel_id,id) on delete cascade
);
create table public.memory_items (
  id uuid primary key default gen_random_uuid(), novel_id uuid not null references public.novels(id) on delete cascade, chapter_id uuid,
  memory_type text not null default 'other' check (memory_type in ('character','relationship','world','timeline','location','item','ability','secret','foreshadowing','plot','rule','other')),
  title text not null, content text not null default '', importance integer not null default 3 check (importance between 1 and 5),
  status text not null default 'active' check (status in ('active','resolved','obsolete')),
  source_type text not null default 'manual' check (source_type in ('chapter','character','world_entry','manual','ai')),
  source_id uuid, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (novel_id,chapter_id) references public.chapters(novel_id,id) on delete set null (chapter_id)
);

create index novels_owner_updated_idx on public.novels(user_id, updated_at desc);
create index volumes_novel_sort_idx on public.volumes(novel_id,sort_order);
create index chapters_novel_sort_idx on public.chapters(novel_id,sort_order);
create index chapters_volume_idx on public.chapters(volume_id);
create index versions_chapter_created_idx on public.chapter_versions(chapter_id,created_at desc);
create index characters_novel_idx on public.characters(novel_id);
create index characters_first_chapter_idx on public.characters(first_appearance_chapter_id);
create index world_novel_idx on public.world_entries(novel_id);
create index world_chapter_idx on public.world_entries(chapter_id);
create index timeline_novel_sort_idx on public.timeline_events(novel_id,sort_order);
create index timeline_chapter_idx on public.timeline_events(chapter_id);
create index summaries_novel_idx on public.chapter_summaries(novel_id);
create index memory_novel_type_idx on public.memory_items(novel_id,memory_type);
create index memory_chapter_idx on public.memory_items(chapter_id);
create index memory_source_idx on public.memory_items(source_type,source_id);

-- RLS is authoritative even if a browser directly calls Supabase REST.
alter table public.profiles enable row level security;
create policy profiles_owner on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter table public.novels enable row level security;
create policy novels_owner on public.novels for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
do $$ declare table_name text; begin
  foreach table_name in array array['volumes','chapters','characters','world_entries','timeline_events','novel_bible','chapter_summaries','memory_items'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (exists (select 1 from public.novels n where n.id = novel_id and n.user_id = (select auth.uid()))) with check (exists (select 1 from public.novels n where n.id = novel_id and n.user_id = (select auth.uid())))', table_name || '_owner', table_name);
  end loop;
end $$;
alter table public.chapter_versions enable row level security;
create policy versions_owner_read on public.chapter_versions for select to authenticated using (exists (select 1 from public.chapters c join public.novels n on n.id=c.novel_id where c.id=chapter_id and n.user_id=(select auth.uid())));
create policy versions_owner_insert on public.chapter_versions for insert to authenticated with check (exists (select 1 from public.chapters c join public.novels n on n.id=c.novel_id where c.id=chapter_id and n.user_id=(select auth.uid())));

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles,public.novels,public.volumes,public.chapters,public.characters,public.world_entries,public.timeline_events,public.novel_bible,public.chapter_summaries,public.memory_items to authenticated;
revoke all on public.chapter_versions from anon,authenticated;
grant select,insert on public.chapter_versions to authenticated;

create function public.studio_set_updated_at() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at=clock_timestamp();
  if new.id<>old.id then raise exception 'ID_IMMUTABLE' using errcode='23514'; end if;
  if tg_table_name in ('novels','chapters') then new.revision=old.revision+1; end if;
  if tg_table_name not in ('novels','profiles') then
    if new.novel_id<>old.novel_id then raise exception 'NOVEL_ID_IMMUTABLE' using errcode='23514'; end if;
  end if;
  return new;
end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','novels','volumes','chapters','characters','world_entries','timeline_events','novel_bible','chapter_summaries','memory_items'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.studio_set_updated_at()',table_name);
  end loop;
end $$;

-- Every child change also invalidates stale clients, including direct REST writes.
create function public.studio_touch_parent() returns trigger language plpgsql set search_path='' as $$
begin
  update public.novels set updated_at=clock_timestamp() where id=case when tg_op='DELETE' then old.novel_id else new.novel_id end;
  return null;
end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['volumes','chapters','characters','world_entries','timeline_events','novel_bible','chapter_summaries','memory_items'] loop
    execute format('create trigger touch_parent after insert or update or delete on public.%I for each row execute function public.studio_touch_parent()',table_name);
  end loop;
end $$;

create function public.studio_word_count() returns trigger language plpgsql set search_path='' as $$
begin new.word_count=char_length(regexp_replace(new.content,'[[:space:]]','','g')); return new; end $$;
create trigger chapter_word_count before insert or update on public.chapters for each row execute function public.studio_word_count();
create trigger version_word_count before insert on public.chapter_versions for each row execute function public.studio_word_count();
create function public.studio_sync_summary() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.chapter_summaries(chapter_id,novel_id,summary) values(new.id,new.novel_id,new.summary)
  on conflict(chapter_id) do update set summary=excluded.summary;
  return null;
end $$;
create trigger chapter_summary after insert or update of summary on public.chapters for each row execute function public.studio_sync_summary();

-- Polymorphic sources are checked in the database, including same-owner/different-novel references.
create function public.studio_validate_memory_source() returns trigger language plpgsql set search_path='' as $$
declare valid boolean; begin
  if new.source_type in ('manual','ai') then
    if new.source_id is not null then raise exception 'SOURCE_INVALID: manual/ai sources cannot reference an arbitrary record' using errcode='23514'; end if;
  else
    if new.source_id is null then raise exception 'SOURCE_INVALID: a source record is required' using errcode='23514'; end if;
    if new.source_type='chapter' then select true into valid from public.chapters where id=new.source_id and novel_id=new.novel_id for key share;
    elsif new.source_type='character' then select true into valid from public.characters where id=new.source_id and novel_id=new.novel_id for key share;
    elsif new.source_type='world_entry' then select true into valid from public.world_entries where id=new.source_id and novel_id=new.novel_id for key share;
    end if;
    if valid is distinct from true then raise exception 'SOURCE_INVALID: source must belong to this novel' using errcode='23514'; end if;
    if new.source_type='chapter' then
      if new.chapter_id is not null and new.chapter_id<>new.source_id then raise exception 'SOURCE_INVALID: chapter and source disagree' using errcode='23514'; end if;
      new.chapter_id=new.source_id;
    end if;
  end if;
  return new;
end $$;
create trigger validate_memory_source before insert or update on public.memory_items for each row execute function public.studio_validate_memory_source();
-- Preserve traceability: a source cannot disappear while live memories reference it.
-- Deleting its entire novel remains possible through the parent's cascade.
create function public.studio_protect_source() returns trigger language plpgsql set search_path='' as $$
declare source_kind text; begin
  source_kind=case tg_table_name when 'chapters' then 'chapter' when 'characters' then 'character' else 'world_entry' end;
  if exists(select 1 from public.novels where id=old.novel_id) and exists(select 1 from public.memory_items where novel_id=old.novel_id and source_type=source_kind and source_id=old.id) then
    raise exception 'SOURCE_IN_USE: update or remove referencing memories first' using errcode='23503';
  end if;
  return old;
end $$;
create trigger protect_chapter_source before delete on public.chapters for each row execute function public.studio_protect_source();
create trigger protect_character_source before delete on public.characters for each row execute function public.studio_protect_source();
create trigger protect_world_source before delete on public.world_entries for each row execute function public.studio_protect_source();

create function public.studio_new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')) on conflict(id) do nothing; return new; end $$;
create trigger create_profile after insert on auth.users for each row execute function public.studio_new_profile();

-- All application writes below are SECURITY INVOKER: RLS still applies.
create function public.studio_create_novel(p_input jsonb) returns uuid language plpgsql set search_path='' as $$
declare novel_uuid uuid; volume_uuid uuid; begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  insert into public.novels(user_id,title,genre,style,premise,protagonist,target_word_count,target_chapter_count,chapter_word_target)
  values(auth.uid(),coalesce(nullif(p_input->>'title',''),'未命名小说'),p_input->>'genre',p_input->>'style',p_input->>'idea',coalesce(p_input->>'protagonist',''),(p_input->>'targetWords')::integer,(p_input->>'targetChapters')::integer,(p_input->>'wordsPerChapter')::integer) returning id into novel_uuid;
  insert into public.novel_bible(novel_id,core_premise,writing_style) values(novel_uuid,p_input->>'idea',p_input->>'style');
  insert into public.volumes(novel_id,title,sort_order) values(novel_uuid,'第一卷',1) returning id into volume_uuid;
  insert into public.chapters(novel_id,volume_id,title,sort_order) values(novel_uuid,volume_uuid,'第一章',1);
  return novel_uuid;
end $$;

-- Whitelisted dynamic patching updates records in place; sources and versions keep stable IDs.
create function public.studio_patch_novel(p_novel_id uuid,p_expected_revision bigint,p_patch jsonb default '{}',p_collections jsonb default '{}') returns bigint language plpgsql set search_path='' as $$
declare actual_revision bigint; table_name text; changes jsonb; record_data jsonb; record_id uuid; allowed text[]; key_name text; column_list text; select_list text; update_list text; affected integer; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  if p_patch<>'{}'::jsonb then
    allowed=array['title','description','genre','style','premise','protagonist','master_outline','target_word_count','target_chapter_count','chapter_word_target','status','cover_url','cover_theme']; update_list='';
    for key_name in select jsonb_object_keys(p_patch) loop
      if not (key_name=any(allowed)) then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
      update_list=update_list||case when update_list='' then '' else ',' end||format('%1$I=(jsonb_populate_record(null::public.novels,$1)).%1$I',key_name);
    end loop;
    execute 'update public.novels set '||update_list||' where id=$2' using p_patch,p_novel_id;
  end if;
  -- Deletions run in reverse dependency order. References remain protected.
  foreach table_name in array array['memory_items','timeline_events','world_entries','characters','chapters','volumes'] loop
    for record_data in select value from jsonb_array_elements(coalesce(p_collections->table_name->'delete','[]')) loop
      execute format('delete from public.%I where id=$1 and novel_id=$2',table_name) using (record_data#>>'{}')::uuid,p_novel_id;
    end loop;
  end loop;
  foreach table_name in array array['novel_bible','volumes','chapters','characters','world_entries','timeline_events','memory_items'] loop
    allowed=case table_name
      when 'novel_bible' then array['core_premise','world_rules','story_tone','writing_style','protagonist_arc','main_conflict','power_system','romance_direction','ending_direction','forbidden_changes','synopsis','storyline','antagonist']
      when 'volumes' then array['title','summary','sort_order','chapter_range','status','beats']
      when 'chapters' then array['volume_id','title','content','outline','summary','status','sort_order']
      when 'characters' then array['name','aliases','role','gender','age','description','personality','appearance','background','goals','relationships','abilities','current_state','traits','color','first_appearance_chapter_id','is_alive']
      when 'world_entries' then array['category','name','content','metadata','chapter_id']
      when 'timeline_events' then array['chapter_id','event_time','title','description','characters','importance','kind','sort_order']
      else array['chapter_id','memory_type','title','content','importance','status','source_type','source_id','metadata'] end;
    changes=coalesce(p_collections->table_name->'upsert','[]');
    for record_data in select value from jsonb_array_elements(changes) loop
      record_id=(record_data->>'id')::uuid;
      if record_id is null then raise exception 'ID_REQUIRED' using errcode='22023'; end if;
      record_data=(record_data-'id')||jsonb_build_object('id',record_id,'novel_id',p_novel_id);
      column_list='id,novel_id'; select_list='r.id,r.novel_id'; update_list='';
      for key_name in select jsonb_object_keys(record_data-'id'-'novel_id') loop
        if not (key_name=any(allowed)) then raise exception 'INVALID_FIELD' using errcode='22023'; end if;
        column_list=column_list||format(',%I',key_name); select_list=select_list||format(',r.%I',key_name);
        update_list=update_list||case when update_list='' then '' else ',' end||format('%1$I=excluded.%1$I',key_name);
      end loop;
      if update_list='' then continue; end if;
      execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) r on conflict(id) do update set %4$s where %1$I.novel_id=$2',table_name,column_list,select_list,update_list) using record_data,p_novel_id;
      get diagnostics affected=row_count;
      if affected<>1 then raise exception 'RECORD_OWNERSHIP_MISMATCH' using errcode='42501'; end if;
    end loop;
  end loop;
  select revision into actual_revision from public.novels where id=p_novel_id;
  return actual_revision;
end $$;

create function public.studio_save_chapter(p_novel_id uuid,p_chapter_id uuid,p_expected_revision bigint,p_values jsonb,p_create_version boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare actual_revision bigint; saved public.chapters; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select revision into actual_revision from public.chapters where id=p_chapter_id and novel_id=p_novel_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  update public.chapters set title=p_values->>'title',outline=p_values->>'outline',content=p_values->>'body',summary=p_values->>'summary',status=case when nullif(p_values->>'body','') is null then 'planned' else 'draft' end where id=p_chapter_id and novel_id=p_novel_id returning * into saved;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_create_version then insert into public.chapter_versions(chapter_id,content,source) values(p_chapter_id,saved.content,'manual'); end if;
  select revision into actual_revision from public.novels where id=p_novel_id;
  return jsonb_build_object('chapter',to_jsonb(saved),'novelRevision',actual_revision);
end $$;
create function public.studio_get_novel(p_novel_id uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'novel',to_jsonb(n),
    'volumes',coalesce((select jsonb_agg(v order by v.sort_order,v.created_at) from public.volumes v where v.novel_id=n.id),'[]'),
    'chapters',coalesce((select jsonb_agg(c order by c.sort_order,c.created_at) from public.chapters c where c.novel_id=n.id),'[]'),
    'characters',coalesce((select jsonb_agg(c order by c.created_at) from public.characters c where c.novel_id=n.id),'[]'),
    'world_entries',coalesce((select jsonb_agg(w order by w.created_at) from public.world_entries w where w.novel_id=n.id),'[]'),
    'timeline_events',coalesce((select jsonb_agg(t order by t.sort_order,t.created_at) from public.timeline_events t where t.novel_id=n.id),'[]'),
    'novel_bible',(select to_jsonb(b) from public.novel_bible b where b.novel_id=n.id),
    'chapter_summaries',coalesce((select jsonb_agg(s order by s.created_at) from public.chapter_summaries s where s.novel_id=n.id),'[]'),
    'memory_items',coalesce((select jsonb_agg(m order by m.created_at) from public.memory_items m where m.novel_id=n.id),'[]')
  ) from public.novels n where n.id=p_novel_id and n.user_id=auth.uid();
$$;
create function public.studio_delete_novel(p_novel_id uuid,p_expected_revision bigint) returns void language plpgsql set search_path='' as $$
declare actual_revision bigint; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  delete from public.novels where id=p_novel_id;
end $$;

-- Default function privileges in PostgreSQL include PUBLIC: narrow all exposed functions.
revoke all on function public.studio_create_novel(jsonb),public.studio_patch_novel(uuid,bigint,jsonb,jsonb),public.studio_save_chapter(uuid,uuid,bigint,jsonb,boolean),public.studio_delete_novel(uuid,bigint),public.studio_get_novel(uuid) from public,anon;
grant execute on function public.studio_create_novel(jsonb),public.studio_patch_novel(uuid,bigint,jsonb,jsonb),public.studio_save_chapter(uuid,uuid,bigint,jsonb,boolean),public.studio_delete_novel(uuid,bigint),public.studio_get_novel(uuid) to authenticated;
revoke all on function public.studio_set_updated_at(),public.studio_touch_parent(),public.studio_word_count(),public.studio_sync_summary(),public.studio_validate_memory_source(),public.studio_protect_source(),public.studio_new_profile() from public,anon,authenticated;

commit;

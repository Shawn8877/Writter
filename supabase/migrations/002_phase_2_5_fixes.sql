-- Business revision conflicts must not use serialization_failure (40001).
-- PostgREST may retry 40001 indefinitely. PT409 returns a stable HTTP conflict.
-- Keep the original migration unchanged; preserve ownership, locks and RLS.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;
create or replace function public.studio_patch_novel(p_novel_id uuid,p_expected_revision bigint,p_patch jsonb default '{}',p_collections jsonb default '{}') returns bigint language plpgsql set search_path='' as $$
declare actual_revision bigint; table_name text; changes jsonb; record_data jsonb; record_id uuid; allowed text[]; key_name text; column_list text; select_list text; update_list text; affected integer; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
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

create or replace function public.studio_save_chapter(p_novel_id uuid,p_chapter_id uuid,p_expected_revision bigint,p_values jsonb,p_create_version boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare actual_revision bigint; saved public.chapters; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select revision into actual_revision from public.chapters where id=p_chapter_id and novel_id=p_novel_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  update public.chapters set title=p_values->>'title',outline=p_values->>'outline',content=p_values->>'body',summary=p_values->>'summary',status=case when nullif(p_values->>'body','') is null then 'planned' else 'draft' end where id=p_chapter_id and novel_id=p_novel_id returning * into saved;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_create_version then insert into public.chapter_versions(chapter_id,content,source) values(p_chapter_id,saved.content,'manual'); end if;
  select revision into actual_revision from public.novels where id=p_novel_id;
  return jsonb_build_object('chapter',to_jsonb(saved),'novelRevision',actual_revision);
end $$;

create or replace function public.studio_delete_novel(p_novel_id uuid,p_expected_revision bigint) returns void language plpgsql set search_path='' as $$
declare actual_revision bigint; begin
  select revision into actual_revision from public.novels where id=p_novel_id and user_id=auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if actual_revision<>p_expected_revision or p_expected_revision is null then raise exception 'REVISION_CONFLICT' using errcode='PT409'; end if;
  delete from public.novels where id=p_novel_id;
end $$;

notify pgrst, 'reload schema';
commit;

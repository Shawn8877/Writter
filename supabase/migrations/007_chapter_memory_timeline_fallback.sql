-- Important chapter events are already grounded facts. When the model omits its
-- optional timeline projection, derive it without another AI call or invented date.
begin;
create function public.studio_project_chapter_events() returns trigger language plpgsql security definer set search_path='' as $$
declare event jsonb; chapter_order integer; begin
  if new.analysis_content_hash is null or jsonb_typeof(new.key_events)<>'array' then return new; end if;
  if exists(select 1 from public.timeline_events where novel_id=new.novel_id and chapter_id=new.chapter_id) then return new; end if;
  select sort_order into chapter_order from public.chapters where id=new.chapter_id and novel_id=new.novel_id;
  if not found then return new; end if;
  for event in select value from jsonb_array_elements(new.key_events) loop
    if nullif(btrim(event->>'title'),'') is null or nullif(btrim(event->>'description'),'') is null then continue; end if;
    if exists(select 1 from public.timeline_events where novel_id=new.novel_id and chapter_id=new.chapter_id and title=left(event->>'title',100)) then continue; end if;
    insert into public.timeline_events(novel_id,chapter_id,title,description,importance,event_time,kind,sort_order)
      values(new.novel_id,new.chapter_id,left(event->>'title',100),event->>'description',case when event->>'importance' ~ '^[1-5]$' then (event->>'importance')::integer else 3 end,'','已发生',chapter_order);
  end loop;
  return new;
end $$;
create trigger project_chapter_events after insert or update of key_events on public.chapter_summaries for each row execute function public.studio_project_chapter_events();
revoke all on function public.studio_project_chapter_events() from public,anon,authenticated;
-- Repair only previously analysed chapters lacking any timeline projection.
update public.chapter_summaries s set key_events=s.key_events
  where s.analysis_content_hash is not null and not exists(select 1 from public.timeline_events t where t.chapter_id=s.chapter_id and t.novel_id=s.novel_id);
notify pgrst, 'reload schema';
commit;

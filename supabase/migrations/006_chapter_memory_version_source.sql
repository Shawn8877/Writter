-- Editing prose invalidates the optional link to the original AI version.
begin;
create or replace function public.studio_stale_chapter_memory() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.content is distinct from old.content then
    update public.chapter_memory_jobs set status=case when status='running' then status else 'stale' end,
      version_id=null,updated_at=clock_timestamp() where chapter_id=new.id;
  end if;
  return new;
end $$;
update public.chapter_memory_jobs j set version_id=null
  where version_id is not null and not exists(select 1 from public.chapter_versions v join public.chapters c on c.id=v.chapter_id where v.id=j.version_id and c.id=j.chapter_id and v.content=c.content);
notify pgrst, 'reload schema';
commit;

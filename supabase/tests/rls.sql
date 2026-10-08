-- Run after migrations as the database owner (Supabase SQL Editor or psql).
-- All fixture records and functions are rolled back. No real account is modified.
begin;
create temporary table studio_test_ids(key text primary key,id uuid);
grant all on studio_test_ids to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111','rls-a@example.invalid','{}'),
  ('22222222-2222-4222-8222-222222222222','rls-b@example.invalid','{}');

create function pg_temp.expect_true(value boolean, label text) returns void language plpgsql as $$
begin if value is not true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_rejected(statement text, expected_code text, label text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected_code then return; end if;
    raise exception 'FAIL: % expected %, got %: %',label,expected_code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded',label;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into studio_test_ids select 'a', public.studio_create_novel('{"genre":"玄幻","style":"细腻沉浸","idea":"A","protagonist":"主角A","targetWords":100000,"targetChapters":50,"wordsPerChapter":2000}');
insert into studio_test_ids select 'a2', public.studio_create_novel('{"genre":"玄幻","style":"细腻沉浸","idea":"A2","protagonist":"主角A2","targetWords":100000,"targetChapters":50,"wordsPerChapter":2000}');
insert into studio_test_ids select 'ca',id from public.chapters where novel_id=(select id from studio_test_ids where key='a');
insert into studio_test_ids select 'ca2',id from public.chapters where novel_id=(select id from studio_test_ids where key='a2');
insert into studio_test_ids select 'va',id from public.volumes where novel_id=(select id from studio_test_ids where key='a');
insert into public.characters(novel_id,name) select id,'人物A' from studio_test_ids where key='a';
insert into public.world_entries(novel_id,name) select id,'世界A' from studio_test_ids where key='a';
insert into public.timeline_events(novel_id,title) select id,'时间A' from studio_test_ids where key='a';
insert into public.memory_items(novel_id,title,memory_type,source_type,source_id) select n.id,'来源可查','ability','chapter',c.id from studio_test_ids n,studio_test_ids c where n.key='a' and c.key='ca';
insert into studio_test_ids select 'person',id from public.characters where novel_id=(select id from studio_test_ids where key='a');
insert into studio_test_ids select 'world',id from public.world_entries where novel_id=(select id from studio_test_ids where key='a');
select pg_temp.expect_true((select count(*)=1 from public.profiles),'profile RLS A');
select pg_temp.expect_true((select count(*)=2 from public.novels),'own novels visible');

-- Atomic save, summary synchronization and explicit-only version creation.
do $$ declare n uuid; c uuid; r bigint; result jsonb; begin
  select id into n from studio_test_ids where key='a'; select id into c from studio_test_ids where key='ca';
  select revision into r from public.chapters where id=c;
  result=public.studio_save_chapter(n,c,r,'{"title":"手动章","outline":"大纲","body":"甲 乙\n丙","summary":"测试摘要"}',false);
  perform pg_temp.expect_true((result->'chapter'->>'word_count')::int=3,'database word count');
  perform pg_temp.expect_true((select summary='测试摘要' from public.chapter_summaries where chapter_id=c),'summary synced');
  perform pg_temp.expect_true((select count(*)=0 from public.chapter_versions where chapter_id=c),'autosave creates no version');
  perform pg_temp.expect_rejected(format('select public.studio_save_chapter(%L,%L,%s,%L,false)',n,c,r,'{"title":"冲突","outline":"","body":"不可覆盖","summary":""}'),'PT409','stale revision');
  select revision into r from public.chapters where id=c;
  result=public.studio_save_chapter(n,c,r,'{"title":"版本章","outline":"大纲","body":"版本正文","summary":"新摘要"}',true);
  perform pg_temp.expect_true((select count(*)=1 from public.chapter_versions where chapter_id=c),'explicit version');
  perform pg_temp.expect_rejected(format('update public.chapter_versions set content=''tamper'' where chapter_id=%L',c),'42501','versions immutable');
  perform pg_temp.expect_true((public.studio_get_novel(n)->'memory_items'->0->>'source_id')::uuid=c,'source preserved');
end $$;

-- References may never cross novels, even if the same user owns both.
select pg_temp.expect_rejected(format('insert into public.chapters(novel_id,volume_id,title) values(%L,%L,''bad'')',(select id from studio_test_ids where key='a2'),(select id from studio_test_ids where key='va')),'23503','cross-novel volume');
select pg_temp.expect_rejected(format('insert into public.characters(novel_id,name,first_appearance_chapter_id) values(%L,''bad'',%L)',(select id from studio_test_ids where key='a2'),(select id from studio_test_ids where key='ca')),'23503','cross-novel appearance');
select pg_temp.expect_rejected(format('insert into public.memory_items(novel_id,title,source_type,source_id) values(%L,''bad'',''chapter'',%L)',(select id from studio_test_ids where key='a2'),(select id from studio_test_ids where key='ca')),'23514','cross-novel memory source');
select pg_temp.expect_rejected(format('delete from public.chapters where id=%L',(select id from studio_test_ids where key='ca')),'23503','referenced source cannot disappear');
select pg_temp.expect_rejected(format('update public.characters set novel_id=%L where id=%L',(select id from studio_test_ids where key='a2'),(select id from studio_test_ids where key='person')),'23514','novel relation immutable');

-- Patch updates records in place and preserves unedited structured fields.
do $$ declare n uuid; r bigint; person uuid; begin
  select id into n from studio_test_ids where key='a'; select id into person from studio_test_ids where key='person';
  update public.characters set relationships='[{"to":"friend","kind":"ally"}]' where id=person;
  select revision into r from public.novels where id=n;
  perform public.studio_patch_novel(n,r,'{"title":"重命名"}',jsonb_build_object('characters',jsonb_build_object('upsert',jsonb_build_array(jsonb_build_object('id',person,'name','改名后')))));
  perform pg_temp.expect_true((select name='改名后' and relationships='[{"to":"friend","kind":"ally"}]'::jsonb from public.characters where id=person),'partial patch retains JSON');
  perform pg_temp.expect_rejected(format('select public.studio_patch_novel(%L,%s,%L)',n,r,'{"title":"旧版本覆盖"}'),'PT409','metadata CAS');
  select revision into r from public.novels where id=n;
  perform pg_temp.expect_rejected(format('select public.studio_patch_novel(%L,%s,%L,%L)',n,r,'{"title":"必须回滚"}',jsonb_build_object('memory_items',jsonb_build_object('upsert',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','错误来源','source_type','chapter','source_id',(select id from studio_test_ids where key='ca2')))))),'23514','atomic mutation failure');
  perform pg_temp.expect_true((select title='重命名' and revision=r from public.novels where id=n),'failed transaction rolled back metadata and revision');
end $$;

-- Switch to B and verify every table is isolated.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_true((select count(*)=1 from public.profiles),'profile RLS B');
select pg_temp.expect_true(public.studio_get_novel((select id from studio_test_ids where key='a')) is null,'RPC read rejects B');
do $$ declare t text; n integer; target uuid; begin
  select id into target from studio_test_ids where key='a';
  foreach t in array array['novels','volumes','chapters','chapter_versions','characters','world_entries','timeline_events','novel_bible','chapter_summaries','memory_items'] loop
    execute format('select count(*) from public.%I',t) into n;
    perform pg_temp.expect_true(n=0,t||' cross-user read');
  end loop;
  foreach t in array array['novels','volumes','chapters','characters','world_entries','timeline_events','novel_bible','chapter_summaries','memory_items'] loop
    execute format('update public.%I set updated_at=now()',t); get diagnostics n=row_count;
    perform pg_temp.expect_true(n=0,t||' cross-user update');
    execute format('delete from public.%I',t); get diagnostics n=row_count;
    perform pg_temp.expect_true(n=0,t||' cross-user delete');
  end loop;
  perform pg_temp.expect_rejected(format('insert into public.volumes(novel_id,title) values(%L,''B injection'')',target),'42501','foreign insert');
  perform pg_temp.expect_rejected(format('insert into public.chapters(novel_id,title) values(%L,''B injection'')',target),'42501','foreign chapter insert');
  perform pg_temp.expect_rejected(format('insert into public.characters(novel_id,name) values(%L,''B injection'')',target),'42501','foreign character insert');
  perform pg_temp.expect_rejected(format('insert into public.world_entries(novel_id,name) values(%L,''B injection'')',target),'42501','foreign world insert');
  perform pg_temp.expect_rejected(format('insert into public.timeline_events(novel_id,title) values(%L,''B injection'')',target),'42501','foreign timeline insert');
  perform pg_temp.expect_rejected(format('insert into public.novel_bible(novel_id) values(%L)',target),'42501','foreign bible insert');
  perform pg_temp.expect_rejected(format('insert into public.chapter_summaries(novel_id,chapter_id) values(%L,%L)',target,(select id from studio_test_ids where key='ca')),'42501','foreign summary insert');
  perform pg_temp.expect_rejected(format('insert into public.memory_items(novel_id,title) values(%L,''B injection'')',target),'42501','foreign memory insert');
  perform pg_temp.expect_rejected(format('insert into public.chapter_versions(chapter_id,content) values(%L,''B injection'')',(select id from studio_test_ids where key='ca')),'42501','foreign version insert');
  perform pg_temp.expect_rejected(format('select public.studio_patch_novel(%L,1,%L)',target,'{"title":"B injection"}'),'P0002','foreign RPC patch');
  perform pg_temp.expect_rejected(format('select public.studio_delete_novel(%L,1)',target),'P0002','foreign RPC delete');
end $$;
insert into studio_test_ids select 'b',public.studio_create_novel('{"genre":"科幻","style":"冷峻写实","idea":"B","protagonist":"B","targetWords":50000,"targetChapters":20,"wordsPerChapter":2500}');
select pg_temp.expect_true((select count(*)=1 from public.novels),'B own novel creation');
select pg_temp.expect_rejected('insert into public.novels(user_id,title) values(''11111111-1111-4111-8111-111111111111'',''spoof'')','42501','owner spoof');

-- Delete the whole A novel: descendants and immutable history must cascade.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.studio_delete_novel(id,revision) from public.novels where id=(select id from studio_test_ids where key='a');
select pg_temp.expect_true((select count(*)=0 from public.chapters where id=(select id from studio_test_ids where key='ca')),'chapter cascade');
select pg_temp.expect_true((select count(*)=0 from public.chapter_versions),'version cascade');
select pg_temp.expect_true((select count(*)=0 from public.memory_items),'memory cascade');
reset role;
select 'PASS: schema, owner RLS, atomic CAS, summary, immutable versions, source integrity and cascade' as result;
rollback;

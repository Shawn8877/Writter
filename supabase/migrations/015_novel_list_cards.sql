begin;

-- Dashboard needs counts, not every novel's prose, memory and version history.
-- Existing novels_owner_updated_idx / chapters_novel_sort_idx cover this query.
create function public.studio_list_novel_cards(p_limit integer default 500, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(card) order by card.updated_at desc, card.id), '[]'::jsonb)
  from (
    select n.id,n.user_id,n.title,n.description,n.genre,n.style,n.premise,
      n.target_word_count,n.target_chapter_count,n.chapter_word_target,n.status,
      n.cover_theme,n.cover_url,n.revision,n.created_at,n.updated_at,
      (select count(*) from public.chapters c where c.novel_id=n.id) as chapter_count,
      (select coalesce(sum(c.word_count),0) from public.chapters c where c.novel_id=n.id) as word_count
    from public.novels n where n.user_id=(select auth.uid())
    order by n.updated_at desc,n.id
    limit least(greatest(coalesce(p_limit,500),1),500)
    offset greatest(coalesce(p_offset,0),0)
  ) card;
$$;
revoke all on function public.studio_list_novel_cards(integer,integer) from public,anon;
grant execute on function public.studio_list_novel_cards(integer,integer) to authenticated;

commit;

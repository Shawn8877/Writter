-- Phase 3D recovery compares the saved report's context revision before reuse.
-- The existing owner-only RLS still applies; lease tokens remain unreadable.
begin;
grant select(novel_revision) on public.chapter_reviews to authenticated;
commit;

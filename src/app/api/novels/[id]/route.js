import { getApiAuth } from "@/lib/auth/server";
import { createSupabaseNovelRepository, apiError, readJson } from "@/lib/server/supabase-repository";

export async function GET(request, { params }) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try { const { id } = await params; return Response.json({ novel: await createSupabaseNovelRepository(supabase, user).get(id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request, { params }) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try {
    const { id } = await params;
    const body = await readJson(request);
    return Response.json({ novel: await createSupabaseNovelRepository(supabase, user).update(id, body.expectedRevision, body.novel) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request, { params }) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try {
    const { id } = await params;
    const body = await readJson(request, 2000);
    await createSupabaseNovelRepository(supabase, user).remove(id, body.expectedRevision);
    return Response.json({ deleted: true });
  } catch (error) { return apiError(error); }
}

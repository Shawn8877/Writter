import { getApiAuth } from "@/lib/auth/server";
import { createSupabaseNovelRepository, apiError, readJson } from "@/lib/server/supabase-repository";

export async function POST(request, { params }) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try {
    const { id } = await params;
    const body = await readJson(request, 5000000);
    const result = await createSupabaseNovelRepository(supabase, user).saveChapter(body.novelId, id, body.values, body.expectedRevision, body.createVersion);
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

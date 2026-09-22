import { getApiAuth } from "@/lib/auth/server";
import { createSupabaseNovelRepository, apiError } from "@/lib/server/supabase-repository";

export async function GET(request, { params }) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try {
    const { id } = await params;
    const novelId = new URL(request.url).searchParams.get("novelId");
    return Response.json({ versions: await createSupabaseNovelRepository(supabase, user).versions(novelId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

import { getApiAuth } from "@/lib/auth/server";
import { createSupabaseNovelRepository, apiError, readJson } from "@/lib/server/supabase-repository";

export async function GET() {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try { return Response.json({ novels: await createSupabaseNovelRepository(supabase, user).list() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error); }
}

export async function POST(request) {
  const { supabase, user, error } = await getApiAuth();
  if (error) return error;
  try { return Response.json({ novel: await createSupabaseNovelRepository(supabase, user).create(await readJson(request, 50000)) }, { status: 201 }); }
  catch (error) { return apiError(error); }
}

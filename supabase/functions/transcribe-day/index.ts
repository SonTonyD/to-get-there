import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) throw new Error('Non authentifié');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Session invalide');
    const { storagePath } = await req.json();
    if (!storagePath || !storagePath.startsWith(`${user.id}/`)) throw new Error('Fichier non autorisé');
    const { data: media } = await supabase.from('trip_media').select('id').eq('storage_path', storagePath).single();
    if (!media) throw new Error('Média introuvable');
    const { data: audio, error } = await supabase.storage.from('trip-media').download(storagePath);
    if (error) throw error;
    const form = new FormData();
    form.append('file', audio, storagePath.split('/').pop() ?? 'recit.webm');
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('language', 'fr');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` }, body: form });
    if (!response.ok) throw new Error(`Transcription OpenAI: ${await response.text()}`);
    const result = await response.json();
    return Response.json({ text: result.text }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Erreur de transcription' }, { status: 400, headers: cors });
  }
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const MODEL = Deno.env.get('OPENAI_VIDEO_MODEL') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.6-luna';

const storyboardSchema = {
  type: 'object', additionalProperties: false, required: ['title', 'scenes'], properties: {
    title: { type: 'string' },
    scenes: { type: 'array', minItems: 4, maxItems: 18, items: {
      type: 'object', additionalProperties: false,
      required: ['sceneType', 'duration', 'title', 'caption', 'mediaIds', 'transition'],
      properties: {
        sceneType: { type: 'string', enum: ['intro', 'memory', 'quote', 'outro'] },
        duration: { type: 'number', minimum: 1, maximum: 8 },
        title: { type: 'string' }, caption: { type: 'string' },
        mediaIds: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        transition: { type: 'string', enum: ['cut', 'fade', 'slide', 'flash'] }
      }
    }}
  }
};

function outputText(result: any) {
  return result.output_text ?? result.output?.flatMap((item: any) => item.content ?? [])
    .find((item: any) => item.type === 'output_text')?.text;
}

function fallbackStoryboard(trip: any, days: any[], media: any[], targetDuration: number) {
  const photos = media.filter(item => item.media_type === 'photo');
  const memories = days.flatMap((day: any) => {
    const journal = Array.isArray(day.day_journals) ? day.day_journals[0] : day.day_journals;
    const dayPhotos = photos.filter(item => item.trip_day_id === day.id);
    const events = journal?.journal_events?.length ? journal.journal_events.slice(0, 2) : [null];
    return events.map((event: any, index: number) => ({
      sceneType: 'memory', duration: targetDuration === 60 ? 4.5 : 3,
      title: event?.title || journal?.title || `Jour ${day.day_number}`,
      caption: event?.description || journal?.summary || day.notes || '',
      mediaIds: dayPhotos.slice(index, index + 2).map((item: any) => item.id), transition: index ? 'slide' : 'fade'
    }));
  }).slice(0, targetDuration === 60 ? 12 : 7);
  return { title: `${trip.title} · le film`, scenes: [
    { sceneType: 'intro', duration: 3, title: trip.title, caption: trip.country, mediaIds: photos.slice(0, 1).map(item => item.id), transition: 'fade' },
    ...memories,
    { sceneType: 'outro', duration: 3, title: 'À bientôt sur la route', caption: `${days.length} jours de souvenirs`, mediaIds: photos.slice(-2).map(item => item.id), transition: 'fade' }
  ] };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) throw new Error('AUTH_REQUIRED');
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('AUTH_REQUIRED');

    const { tripId, tripDayId = null, format = 'vertical', targetDuration = 30, style = {} } = await req.json();
    if (!tripId || !['vertical', 'horizontal'].includes(format) || ![30, 60].includes(Number(targetDuration))) throw new Error('VIDEO_CONFIG_INVALID');
    const { data: trip } = await userClient.from('trips').select('id,title,country,start_date,end_date,owner_id').eq('id', tripId).eq('owner_id', user.id).single();
    if (!trip) throw new Error('VIDEO_TRIP_FORBIDDEN');

    let dayQuery = userClient.from('trip_days').select('id,day_number,day_date,notes,day_journals(title,summary,journal_events(event_order,title,description,place_text))').eq('trip_id', tripId).order('day_number');
    if (tripDayId) dayQuery = dayQuery.eq('id', tripDayId);
    const { data: days, error: daysError } = await dayQuery;
    if (daysError) throw daysError;
    const dayIds = (days ?? []).map((day: any) => day.id);
    const { data: media, error: mediaError } = dayIds.length
      ? await userClient.from('trip_media').select('id,trip_day_id,media_type,original_name,created_at').in('trip_day_id', dayIds).order('created_at')
      : { data: [], error: null };
    if (mediaError) throw mediaError;

    const allowedMediaIds = new Set((media ?? []).map((item: any) => item.id));
    let storyboard: any;
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (apiKey) {
      const prompt = JSON.stringify({
        trip, days, media: (media ?? []).map(({ id, trip_day_id, media_type, original_name, created_at }: any) => ({ id, trip_day_id, media_type, original_name, created_at })),
        constraints: { format, targetDuration, style, language: 'fr', exactTotalDuration: targetDuration }
      });
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, reasoning: { effort: 'low' }, store: false,
          instructions: "Tu es monteuse de films de voyage. Construis un storyboard rythmé, chaleureux et fidèle aux données. N'invente aucun lieu ni événement. Utilise uniquement les mediaIds fournis. Les titres sont très courts, les légendes font moins de 110 caractères. Répartis les scènes pour approcher exactement la durée demandée.",
          input: prompt,
          text: { verbosity: 'low', format: { type: 'json_schema', name: 'travel_memory_video', strict: true, schema: storyboardSchema } }
        })
      });
      if (!response.ok) throw new Error(`OpenAI: ${await response.text()}`);
      const text = outputText(await response.json());
      if (!text) throw new Error('OPENAI_EMPTY_OUTPUT');
      storyboard = JSON.parse(text);
    } else {
      storyboard = fallbackStoryboard(trip, days ?? [], media ?? [], Number(targetDuration));
    }

    storyboard.scenes = storyboard.scenes.map((scene: any, position: number) => ({
      ...scene, position,
      mediaIds: (scene.mediaIds ?? []).filter((id: string) => allowedMediaIds.has(id)),
      settings: { transition: scene.transition ?? 'fade' }
    }));

    const { data: project, error: projectError } = await admin.from('video_projects').insert({
      user_id: user.id, trip_id: tripId, trip_day_id: tripDayId, title: storyboard.title,
      format, target_duration: targetDuration, style_settings: { style: 'scrapbook', ...style }, status: 'storyboard_ready'
    }).select().single();
    if (projectError) throw projectError;
    const { data: scenes, error: sceneError } = await admin.from('video_scenes').insert(storyboard.scenes.map((scene: any) => ({
      project_id: project.id, position: scene.position, scene_type: scene.sceneType,
      duration: scene.duration, title: scene.title, caption: scene.caption,
      media_ids: scene.mediaIds, settings: scene.settings
    }))).select().order('position');
    if (sceneError) throw sceneError;

    return Response.json({ project: { ...project, scenes: scenes ?? [] }, model: apiKey ? MODEL : 'deterministic-fallback' }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'VIDEO_STORYBOARD_FAILED' }, { status: 400, headers: cors });
  }
});

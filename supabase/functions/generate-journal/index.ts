import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const MODEL = 'gpt-5.6-luna';

async function structured(name: string, instructions: string, input: string, schema: Record<string, unknown>) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, reasoning: { effort: 'low' }, store: false, instructions, input, text: { verbosity: 'low', format: { type: 'json_schema', name, strict: true, schema } } })
  });
  if (!response.ok) throw new Error(`OpenAI: ${await response.text()}`);
  const result = await response.json();
  const text = result.output_text ?? result.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === 'output_text')?.text;
  if (!text) throw new Error('Réponse IA vide');
  return JSON.parse(text);
}

const analysisSchema = { type: 'object', additionalProperties: false, required: ['events','places'], properties: {
  events: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['order','type','time','title','facts','place','category','media_ids','confidence','review_reason'], properties: { order:{type:'integer'}, type:{type:'string'}, time:{type:['string','null']}, title:{type:'string'}, facts:{type:'string'}, place:{type:['string','null']}, category:{type:'string'}, media_ids:{type:'array',items:{type:'string'}},confidence:{type:'number'},review_reason:{type:['string','null']} } } },
  places: { type: 'array', items: { type:'object', additionalProperties:false, required:['raw_mention','name','city','category','confidence'], properties:{ raw_mention:{type:'string'}, name:{type:'string'}, city:{type:['string','null']}, category:{type:'string'}, confidence:{type:'number'} } } }
}};
const journalSchema = { type:'object', additionalProperties:false, required:['title','summary','events'], properties:{ title:{type:'string'}, summary:{type:'string'}, events:{type:'array',items:{type:'object',additionalProperties:false,required:['order','type','time','title','description','place','category','media_ids'],properties:{order:{type:'integer'},type:{type:'string'},time:{type:['string','null']},title:{type:'string'},description:{type:'string'},place:{type:['string','null']},category:{type:'string'},media_ids:{type:'array',items:{type:'string'}}}}}}};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let runId: string | undefined;
  try {
    const auth = req.headers.get('Authorization'); if (!auth) throw new Error('Non authentifié');
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user } } = await userClient.auth.getUser(); if (!user) throw new Error('Session invalide');
    const { dayId, rawText, media = [] } = await req.json(); if (!dayId || !rawText?.trim()) throw new Error('Récit manquant');
    const { data: day } = await userClient.from('trip_days').select('id, day_date, trips(title,country)').eq('id', dayId).single(); if (!day) throw new Error('Journée non autorisée');
    const { data: run } = await admin.from('ai_journal_runs').insert({ trip_day_id:dayId, requested_by:user.id, model:MODEL, status:'processing', input_chars:rawText.length }).select().single(); runId=run?.id;
    const context = JSON.stringify({ trip:day.trips, date:day.day_date, narrative:rawText, media });
    const analysis = await structured('travel_day_analysis', 'Extrais uniquement les faits du récit. Crée une chronologie. Les lieux sont des candidats à confirmer : ne les invente jamais. Associe les médias seulement si leur nom fournit un indice fiable. Pour chaque événement, évalue confidence entre 0 et 1. Renseigne review_reason en français si un horaire, un lieu ou un fait est ambigu, sinon null.', context, analysisSchema);
    const journal = await structured('travel_journal', 'Rédige en français un carnet chaleureux, élégant et fidèle. Ne crée aucun fait. Préserve les horaires incertains comme null. Retourne une structure éditable.', JSON.stringify({ context:JSON.parse(context), analysis }), journalSchema);
    const enrichedEvents=journal.events.map((event:any)=>{const source=analysis.events.find((item:any)=>item.order===event.order);const confidence=Number(source?.confidence??1);const reviewReason=source?.review_reason??null;return{...event,confidence,review_reason:reviewReason,review_status:confidence<.78||reviewReason?'pending':'not_required'}});
    const { data: saved } = await admin.from('day_journals').upsert({ trip_day_id:dayId, title:journal.title, summary:journal.summary, raw_text:rawText, ai_model:MODEL, ai_generated_at:new Date().toISOString() }, { onConflict:'trip_day_id' }).select().single();
    await admin.from('journal_events').delete().eq('journal_id',saved.id); await admin.from('place_candidates').delete().eq('journal_id',saved.id);
    if (enrichedEvents.length) await admin.from('journal_events').insert(enrichedEvents.map((e:any)=>({journal_id:saved.id,event_order:e.order,event_type:e.type,event_time:e.time||null,title:e.title,description:e.description,place_text:e.place,category:e.category,confidence:e.confidence,review_reason:e.review_reason,review_status:e.review_status})));
    let candidateRows:any[]=[]; if (analysis.places.length) { const {data}=await admin.from('place_candidates').insert(analysis.places.map((p:any)=>({journal_id:saved.id,raw_mention:p.raw_mention,name:p.name,city:p.city,category:p.category,confidence:p.confidence}))).select(); candidateRows=data??[]; }
    if (runId) await admin.from('ai_journal_runs').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',runId);
    return Response.json({ ...journal,events:enrichedEvents, placeCandidates:candidateRows, model:MODEL }, { headers:cors });
  } catch (error) {
    if (runId) { const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); await admin.from('ai_journal_runs').update({status:'failed',error_message:String(error),completed_at:new Date().toISOString()}).eq('id',runId); }
    return Response.json({ error:error instanceof Error?error.message:'Erreur de génération' }, { status:400, headers:cors });
  }
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

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
    const { projectId } = await req.json();
    const { data: project } = await userClient.from('video_projects').select('id,status').eq('id', projectId).eq('user_id', user.id).single();
    if (!project) throw new Error('VIDEO_PROJECT_FORBIDDEN');

    const { data: render, error } = await admin.from('video_renders').insert({ project_id: projectId, user_id: user.id }).select().single();
    if (error) throw error;
    await admin.from('video_projects').update({ status: 'rendering' }).eq('id', projectId);

    const rendererUrl = Deno.env.get('VIDEO_RENDERER_URL');
    if (!rendererUrl) {
      await admin.from('video_renders').update({ status: 'failed', error_message: 'VIDEO_RENDERER_NOT_CONFIGURED', completed_at: new Date().toISOString() }).eq('id', render.id);
      await admin.from('video_projects').update({ status: 'storyboard_ready' }).eq('id', projectId);
      return Response.json({ render: { ...render, status: 'failed', error_message: 'VIDEO_RENDERER_NOT_CONFIGURED' } }, { headers: cors });
    }

    const response = await fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-secret': Deno.env.get('VIDEO_RENDERER_SECRET') ?? '' },
      body: JSON.stringify({ renderId: render.id })
    });
    if (!response.ok) {
      const message = `VIDEO_RENDERER_REJECTED: ${await response.text()}`;
      await admin.from('video_renders').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('id', render.id);
      await admin.from('video_projects').update({ status: 'storyboard_ready' }).eq('id', projectId);
      throw new Error(message);
    }
    return Response.json({ render }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'VIDEO_RENDER_REQUEST_FAILED' }, { status: 400, headers: cors });
  }
});

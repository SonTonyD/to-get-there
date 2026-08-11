import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) throw new Error('Non authentifié');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Session invalide');

    const { name, city, country } = await req.json();
    if (!name?.trim()) throw new Error('Nom du lieu manquant');

    const { data: cached } = await supabase.from('places').select('*')
      .ilike('name', `%${name.trim()}%`).limit(3);
    const relevantCache = (cached ?? []).filter((place: any) =>
      place.latitude != null && place.longitude != null &&
      (!city || !place.city || place.city.toLowerCase().includes(city.toLowerCase()))
    );
    if (relevantCache.length) {
      return Response.json({ results: relevantCache.map((place: any) => ({
        existingPlaceId: place.id, provider: place.provider, providerPlaceId: place.provider_place_id,
        name: place.name, formatted: [place.name, place.city, place.country].filter(Boolean).join(', '),
        city: place.city, country: place.country, latitude: place.latitude, longitude: place.longitude,
        category: place.category
      })) }, { headers: cors });
    }

    const key = Deno.env.get('GEOAPIFY_API_KEY');
    if (!key) throw new Error('GEOAPIFY_API_KEY n’est pas configurée');
    const query = [name, city, country].filter(Boolean).join(', ');
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text', query); url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '3'); url.searchParams.set('lang', 'fr'); url.searchParams.set('apiKey', key);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geoapify: ${response.status}`);
    const payload = await response.json();
    const results = (payload.results ?? []).map((result: any) => ({
      provider: 'geoapify', providerPlaceId: result.place_id,
      name: result.name || result.address_line1 || name,
      formatted: result.formatted,
      city: result.city || result.county || city || null,
      country: result.country || country || null,
      latitude: result.lat, longitude: result.lon,
      category: result.result_type || result.category || null
    }));
    return Response.json({ results }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Erreur de géocodage' }, { status: 400, headers: cors });
  }
});

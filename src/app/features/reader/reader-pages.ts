export type ReaderComposition = 'editorial' | 'postcard' | 'contact' | 'ticket' | 'journal' | 'polaroid';

export interface ReaderPhoto {
  url: string;
  caption: string;
}

function normalizePhotos(photos: Array<string | Record<string, any>> = []): ReaderPhoto[] {
  return photos
    .map(photo => typeof photo === 'string'
      ? { url: photo, caption: '' }
      : { url: String(photo?.['url'] ?? ''), caption: String(photo?.['caption'] ?? '') })
    .filter(photo => !!photo.url);
}

export function chooseReaderComposition(day: any): ReaderComposition {
  const photos = normalizePhotos(day?.photos);
  const events = day?.events ?? [];
  const distinctPlaces = new Set(events.map((event: any) => event.place).filter(Boolean)).size;
  const timedEvents = events.filter((event: any) => !!event.time).length;
  const textLength = String(day?.summary ?? '').length
    + events.reduce((total: number, event: any) => total + String(event.description ?? '').length, 0);

  if (!photos.length) return 'journal';
  if (photos.length === 1) return 'editorial';
  if (photos.length === 2) return 'postcard';
  if (photos.length >= 5) return 'contact';
  if (distinctPlaces >= 3 || timedEvents >= 4) return 'ticket';
  if (textLength < 220) return 'polaroid';
  return 'editorial';
}

function routePage(places: any[], country: string) {
  const normalized = places.map(place => place?.places ? { ...place.places, ...place } : place);
  const located = normalized.filter(place => Number.isFinite(Number(place?.latitude)) && Number.isFinite(Number(place?.longitude)));
  const cities = [...new Set(normalized.map(place => place?.city).filter(Boolean))].slice(0, 8);
  if (located.length < 2 && cities.length < 2) return null;

  const latitudes = located.map(place => Number(place.latitude));
  const longitudes = located.map(place => Number(place.longitude));
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const pins = located.slice(0, 12).map((place, index) => ({
    name: place.name,
    city: place.city,
    order: index + 1,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    x: 12 + ((Number(place.longitude) - minLon) / Math.max(maxLon - minLon, .0001)) * 76,
    y: 14 + (1 - ((Number(place.latitude) - minLat) / Math.max(maxLat - minLat, .0001))) * 68,
  }));

  return { kind: 'map', layout: 'scrapbook', title: 'D’ici à là', country, cities, pins };
}

export function buildSignatureReaderPages(days: any[], trip: any, defaultDesign: Record<string, any>): any[] {
  const usedTitles = new Set<string>();
  const tripTitle = String(trip?.title ?? '').trim().toLocaleLowerCase('fr');
  const scrapbookDays = days.map((day, index) => {
    const savedTitle = String(day?.title ?? '').trim();
    const normalized = savedTitle.toLocaleLowerCase('fr');
    const repeated = !savedTitle || normalized === tripTitle || usedTitles.has(normalized);
    const eventTitle = String(day?.events?.[0]?.title ?? '').trim();
    const title = repeated ? (eventTitle || `Jour ${index + 1}`) : savedTitle;
    usedTitles.add(title.toLocaleLowerCase('fr'));
    const photos = normalizePhotos(day?.photos);
    return {
      kind: 'day',
      number: index + 1,
      ...day,
      title,
      photos,
      layout: 'scrapbook',
      design: { ...defaultDesign, ...(day?.design ?? {}) },
      composition: chooseReaderComposition({ ...day, photos }),
    };
  });

  const places = trip?.places ?? [];
  const map = routePage(places, trip?.country);
  const storyPages: any[] = [...scrapbookDays];
  if (map) storyPages.splice(Math.max(1, Math.ceil(storyPages.length / 2)), 0, map);

  const recommendations = places
    .map((place: any) => place?.places ? { ...place.places, ...place } : place)
    .filter((place: any) => place?.recommended)
    .slice(0, 4)
    .map((place: any) => ({ ...place, comment: place.comment ?? place.public_comment ?? '' }));
  const favorites = scrapbookDays
    .filter(day => day.photos.length)
    .slice(0, 3)
    .map(day => ({ title: day.title, number: day.number, photo: day.photos[0] }));

  return [
    {
      kind: 'cover', layout: 'scrapbook', title: trip?.title, country: trip?.country,
      author: trip?.author, photo: scrapbookDays.flatMap(day => day.photos)[0]?.url ?? null,
    },
    { kind: 'timeline', layout: 'scrapbook', title: 'Le fil du voyage', country: trip?.country, days: scrapbookDays },
    ...storyPages,
    {
      kind: 'end', layout: 'scrapbook', title: `${trip?.country} en souvenirs`,
      stats: trip?.stats ?? {}, country: trip?.country, favorites, recommendations,
    },
  ];
}

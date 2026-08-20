import { SimpleChange } from '@angular/core';
import { BrowserVideoRendererService } from './browser-video-renderer.service';
import { ShareStudioComponent, ShareStudioSource } from './share-studio.component';

describe('ShareStudioComponent', () => {
  let component: ShareStudioComponent;
  const source: ShareStudioSource = {
    trip: { id: 'trip-1', title: 'Vietnam 2026', country: 'Vietnam' },
    days: [
      { id: 'day-1', number: 1, date: '2026-04-12', title: 'Premiers pas', summary: 'Arrivée à Hô Chi Minh-Ville.' },
      { id: 'day-2', number: 2, date: '2026-04-13', title: 'La ville en mouvement', summary: 'Cafés et musée.' }
    ],
    media: [
      { id: 'photo-1', trip_day_id: 'day-1', url: 'https://example.test/one.jpg', media_type: 'photo' },
      { id: 'photo-2', trip_day_id: 'day-2', url: 'https://example.test/two.jpg', media_type: 'photo' }
    ],
    stats: { days: 2, cities: 1, places: 4, photos: 2 },
    places: [{ recommended: true, public_comment: 'Excellent café', places: { name: 'The Workshop', city: 'Hô Chi Minh-Ville' } }],
    author: 'Élodie',
    publicUrl: 'https://example.test/travel/vietnam-2026'
  };

  beforeEach(() => {
    component = new ShareStudioComponent(new BrowserVideoRendererService());
    component.source = source;
    component.ngOnChanges({ source: new SimpleChange(undefined, source, true) });
  });

  it('prepares a usable draft immediately', () => {
    expect(component.title).toBe('Vietnam 2026');
    expect(component.selectedMediaIds).toEqual(['photo-1', 'photo-2']);
    expect(component.visuals.length).toBeGreaterThan(0);
  });

  it('builds a six-page story pack', () => {
    component.chooseDestination('story');
    expect(component.visuals.length).toBe(6);
    expect(component.dimensionsLabel).toBe('1080 × 1920');
  });

  it('builds a carousel between five and ten pages', () => {
    component.chooseDestination('carousel');
    expect(component.visuals.length).toBeGreaterThanOrEqual(5);
    expect(component.visuals.length).toBeLessThanOrEqual(10);
    expect(component.dimensionsLabel).toBe('1080 × 1350');
  });

  it('focuses the memory card on the selected day', () => {
    component.setScope('day');
    component.chooseDay('day-2');
    component.chooseDestination('card');
    expect(component.visuals).toHaveSize(1);
    expect(component.visuals[0].title).toBe('La ville en mouvement');
  });
});

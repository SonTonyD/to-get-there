import { buildSignatureReaderPages, chooseReaderComposition } from './reader-pages';

describe('signature reader pages', () => {
  it('chooses a composition from the content of a day', () => {
    expect(chooseReaderComposition({ photos: [{ url: 'one.jpg' }] })).toBe('editorial');
    expect(chooseReaderComposition({ photos: [{ url: '1.jpg' }, { url: '2.jpg' }] })).toBe('postcard');
    expect(chooseReaderComposition({ photos: Array.from({ length: 6 }, (_, i) => ({ url: `${i}.jpg` })) })).toBe('contact');
    expect(chooseReaderComposition({ photos: [], summary: 'Un long récit' })).toBe('journal');
  });

  it('inserts a route card and enriches the final page', () => {
    const pages = buildSignatureReaderPages(
      [{ date: '2026-08-01', title: 'Arrivée', photos: ['one.jpg'], events: [] }],
      { title: 'Vietnam', country: 'Vietnam', stats: { days: 1 }, places: [
        { name: 'Café A', city: 'Hanoï', latitude: 21.02, longitude: 105.83, recommended: true },
        { name: 'Musée B', city: 'Huế', latitude: 16.46, longitude: 107.59 },
      ] },
      {},
    );
    expect(pages.some(page => page.kind === 'map')).toBeTrue();
    expect(pages.at(-1).recommendations.length).toBe(1);
    expect(pages.at(-1).favorites.length).toBe(1);
  });
});

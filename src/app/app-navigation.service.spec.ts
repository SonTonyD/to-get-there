import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppNavigationService } from './app-navigation.service';
import { routes } from './app.routes';

describe('AppNavigationService',()=>{
  let navigation:AppNavigationService;

  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[provideRouter(routes)]});
    navigation=TestBed.inject(AppNavigationService);
  });

  it('builds a stable trip day URL',()=>{
    expect(navigation.routeFor('journal',{tripId:'trip 1',dayId:'day/2'})).toBe('/trips/trip%201/days/day%2F2');
  });

  it('restores identifiers from a trip day URL',()=>{
    expect(navigation.parse('/trips/trip-1/days/day-2')).toEqual({screen:'journal',tripId:'trip-1',dayId:'day-2'});
  });

  it('supports a precise public reader page',()=>{
    const url=navigation.routeFor('reader',{readerOrigin:'public',publicationSlug:'japon-2026',readerPage:4});
    expect(url).toBe('/travel/japon-2026/read/4');
    expect(navigation.parse(url)).toEqual({screen:'reader',publicationSlug:'japon-2026',readerPage:4,readerOrigin:'public'});
  });

  it('keeps the requested private URL through login',()=>{
    const login=navigation.loginRoute('/messages/conversation-1');
    expect(navigation.parse(login).returnUrl).toBe('/messages/conversation-1');
  });

  it('lets Angular activate a componentless shell route',async()=>{
    const router=TestBed.inject(Router);
    expect(await router.navigateByUrl('/trips/trip-1/days/day-2')).toBeTrue();
    expect(router.url).toBe('/trips/trip-1/days/day-2');
  });
});

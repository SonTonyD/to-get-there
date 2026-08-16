import { Injectable } from '@angular/core';

export type AppScreen =
  | 'splash' | 'auth' | 'questionnaire' | 'home' | 'trips' | 'new-trip'
  | 'dashboard' | 'journal' | 'explore' | 'destination' | 'place'
  | 'public-trip' | 'public-profile' | 'inspirations' | 'inbox'
  | 'conversation' | 'community-settings' | 'reader' | 'video-studio'
  | 'profile';

export interface NavigationContext {
  tripId?: string;
  dayId?: string;
  publicationSlug?: string;
  username?: string;
  conversationId?: string;
  videoProjectId?: string;
  destinationId?: string;
  placeId?: string;
  readerPage?: number;
  readerOrigin?: 'owner' | 'public';
}

export interface AppRouteState extends NavigationContext {
  screen: AppScreen;
  returnUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AppNavigationService {
  readonly privateScreens = new Set<AppScreen>([
    'home', 'questionnaire', 'trips', 'new-trip', 'dashboard', 'journal', 'video-studio', 'profile',
    'inspirations', 'inbox', 'conversation', 'community-settings'
  ]);

  routeFor(screen: AppScreen, context: NavigationContext = {}): string {
    const tripId = this.segment(context.tripId);
    const dayId = this.segment(context.dayId);
    switch (screen) {
      case 'splash': return '/';
      case 'auth': return '/login';
      case 'questionnaire': return '/onboarding';
      case 'home': return '/home';
      case 'trips': return '/trips';
      case 'new-trip': return '/trips/new';
      case 'dashboard': return tripId ? `/trips/${tripId}` : '/trips';
      case 'journal': return tripId && dayId ? `/trips/${tripId}/days/${dayId}` : tripId ? `/trips/${tripId}` : '/trips';
      case 'explore': return '/explore';
      case 'destination': return context.destinationId ? `/explore/destinations/${this.segment(context.destinationId)}` : '/explore';
      case 'place': return context.placeId ? `/explore/places/${this.segment(context.placeId)}` : '/explore';
      case 'public-trip': return context.publicationSlug ? `/travel/${this.segment(context.publicationSlug)}` : '/explore';
      case 'public-profile': return context.username ? `/profile/${this.segment(context.username)}` : '/explore';
      case 'profile': return '/profile';
      case 'inspirations': return '/inspirations';
      case 'inbox': return '/messages';
      case 'conversation': return context.conversationId ? `/messages/${this.segment(context.conversationId)}` : '/messages';
      case 'community-settings': return '/settings/community';
      case 'video-studio': {
        if (context.videoProjectId) return `/video/${this.segment(context.videoProjectId)}`;
        const query = context.dayId ? `?day=${dayId}` : '';
        return tripId ? `/trips/${tripId}/video${query}` : '/trips';
      }
      case 'reader': {
        const page = Math.max(1, context.readerPage ?? 1);
        if (context.readerOrigin === 'public' && context.publicationSlug) return `/travel/${this.segment(context.publicationSlug)}/read/${page}`;
        return tripId ? `/trips/${tripId}/read/${page}` : '/trips';
      }
    }
  }

  parse(rawUrl: string): AppRouteState {
    const [path, queryString = ''] = rawUrl.split('?');
    const parts = path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    const query = new URLSearchParams(queryString);

    if (!parts.length) return { screen: 'splash' };
    if (parts[0] === 'login') {
      const requested=query.get('returnUrl');
      const returnUrl=requested?.startsWith('/')&&!requested.startsWith('//')?requested:undefined;
      return { screen: 'auth', returnUrl };
    }
    if (parts[0] === 'onboarding') return { screen: 'questionnaire' };
    if (parts[0] === 'home') return { screen: 'home' };
    if (parts[0] === 'trips') {
      if (parts[1] === 'new') return { screen: 'new-trip' };
      if (!parts[1]) return { screen: 'trips' };
      if (parts[2] === 'days' && parts[3]) return { screen: 'journal', tripId: parts[1], dayId: parts[3] };
      if (parts[2] === 'video') return { screen: 'video-studio', tripId: parts[1], dayId: query.get('day') ?? undefined };
      if (parts[2] === 'read') return { screen: 'reader', tripId: parts[1], readerPage: this.page(parts[3]), readerOrigin: 'owner' };
      return { screen: 'dashboard', tripId: parts[1] };
    }
    if (parts[0] === 'explore') {
      if (parts[1] === 'destinations' && parts[2]) return { screen: 'destination', destinationId: parts[2] };
      if (parts[1] === 'places' && parts[2]) return { screen: 'place', placeId: parts[2] };
      return { screen: 'explore' };
    }
    if (parts[0] === 'travel' && parts[1]) {
      if (parts[2] === 'read') return { screen: 'reader', publicationSlug: parts[1], readerPage: this.page(parts[3]), readerOrigin: 'public' };
      return { screen: 'public-trip', publicationSlug: parts[1] };
    }
    if (parts[0] === 'profile') return parts[1] ? { screen: 'public-profile', username: parts[1] } : { screen: 'profile' };
    if (parts[0] === 'messages') return parts[1] ? { screen: 'conversation', conversationId: parts[1] } : { screen: 'inbox' };
    if (parts[0] === 'video' && parts[1]) return { screen: 'video-studio', videoProjectId: parts[1] };
    if (parts[0] === 'inspirations') return { screen: 'inspirations' };
    if (parts[0] === 'settings' && parts[1] === 'community') return { screen: 'community-settings' };
    return { screen: 'splash' };
  }

  loginRoute(returnUrl: string): string {
    return `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  }

  private segment(value?: string): string {
    return value ? encodeURIComponent(value) : '';
  }

  private page(value?: string): number {
    const parsed = Number(value ?? 1);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }
}

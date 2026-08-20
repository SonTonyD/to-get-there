import { Route, Routes } from '@angular/router';

// The visual shell is progressively being split into routed feature domains.
// These componentless routes already provide stable URLs and browser history
// while AppComponent remains the host during the migration.
const shellRoute=(path:string,extra:Partial<Route>={}):Route=>({path,children:[],...extra});

export const routes: Routes = [
  shellRoute('',{pathMatch:'full'}),
  shellRoute('login'),
  shellRoute('onboarding'),
  shellRoute('home'),
  shellRoute('trips'),
  shellRoute('trips/new'),
  shellRoute('trips/:tripId'),
  shellRoute('trips/:tripId/days/:dayId'),
  shellRoute('trips/:tripId/video'),
  shellRoute('trips/:tripId/share'),
  shellRoute('trips/:tripId/read/:page'),
  shellRoute('explore'),
  shellRoute('explore/destinations/:destinationId'),
  shellRoute('explore/places/:placeId'),
  shellRoute('travel/:slug'),
  shellRoute('travel/:slug/share'),
  shellRoute('travel/:slug/read/:page'),
  shellRoute('profile'),
  shellRoute('profile/:username'),
  shellRoute('inspirations'),
  shellRoute('messages'),
  shellRoute('messages/:conversationId'),
  shellRoute('settings/community'),
  shellRoute('video/:projectId'),
  { path: '**', redirectTo: '' }
];

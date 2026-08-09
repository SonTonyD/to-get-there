import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = !environment.supabaseUrl.includes('VOTRE-PROJET')
    && !environment.supabasePublishableKey.includes('VOTRE_CLE');
  private readonly client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabasePublishableKey)
    : null;

  private get db(): SupabaseClient {
    if (!this.client) throw new Error('Supabase n’est pas encore configuré dans src/environments/environment.ts');
    return this.client;
  }

  async currentUser(): Promise<User | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error) return null;
    return data.user;
  }

  async signUp(email: string, password: string, firstname: string, username: string) {
    const { data, error } = await this.db.auth.signUp({
      email, password, options: { data: { firstname, username } }
    });
    if (error) throw error;
    return data;
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async resetPassword(email: string) {
    const { error } = await this.db.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });
    if (error) throw error;
  }

  async signOut() {
    const { error } = await this.db.auth.signOut();
    if (error) throw error;
  }

  async profile(userId: string) {
    const { data, error } = await this.db.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
  }

  async saveProfile(userId: string, profile: { username: string; firstname: string; bio: string }) {
    const { error } = await this.db.from('profiles').update(profile).eq('id', userId);
    if (error) throw error;
  }

  async travelerProfile(userId: string) {
    const { data, error } = await this.db.from('traveler_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async saveTravelerProfile(userId: string, profile: Record<string, unknown>) {
    const { error } = await this.db.from('traveler_profiles').upsert({ user_id: userId, ...profile }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  async trips(userId: string) {
    const { data, error } = await this.db.from('trips')
      .select('*, trip_days(*)').eq('owner_id', userId).order('start_date', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async createTrip(trip: Record<string, unknown>) {
    const { data, error } = await this.db.from('trips').insert(trip).select().single();
    if (error) throw error;
    const { data: days, error: daysError } = await this.db.from('trip_days')
      .select('*').eq('trip_id', data.id).order('day_number');
    if (daysError) throw daysError;
    return { ...data, trip_days: days ?? [] };
  }

  async deleteTrip(id: string) {
    const { error } = await this.db.from('trips').delete().eq('id', id);
    if (error) throw error;
  }

  async journal(dayId: string) {
    const { data, error } = await this.db.from('day_journals')
      .select('*, journal_events(*), place_candidates(*)').eq('trip_day_id', dayId).maybeSingle();
    if (error) throw error;
    if (data?.place_candidates?.length) {
      const { data: visits } = await this.db.from('place_visits').select('*').eq('trip_day_id', dayId);
      data.place_candidates = data.place_candidates.map((candidate: any) => {
        const visit = (visits ?? []).find((item: any) => item.place_id === candidate.resolved_place_id);
        return { ...candidate, visitId: visit?.id, liked: visit?.liked, recommended: visit?.recommended };
      });
    }
    return data;
  }

  async saveJournal(dayId: string, journal: Record<string, unknown>, events: any[] = []) {
    const { data, error } = await this.db.from('day_journals')
      .upsert({ trip_day_id: dayId, ...journal }, { onConflict: 'trip_day_id' }).select().single();
    if (error) throw error;
    if (events.length) {
      await this.db.from('journal_events').delete().eq('journal_id', data.id);
      const { error: eventError } = await this.db.from('journal_events').insert(events.map((event, index) => ({ journal_id: data.id, event_order: index + 1, event_type: event.type ?? event.event_type ?? 'moment', event_time: event.time ?? event.event_time ?? null, title: event.title, description: event.description, place_text: event.place ?? event.place_text ?? null, category: event.category ?? null })));
      if (eventError) throw eventError;
    }
    const dayNote = String(journal['summary'] || journal['title'] || '').trim();
    if (dayNote) {
      const { error: dayError } = await this.db.from('trip_days').update({ notes: dayNote }).eq('id', dayId);
      if (dayError) throw dayError;
    }
    return data;
  }

  async updatePlaceCandidate(id: string, status: 'confirmed' | 'rejected') {
    const { error } = await this.db.from('place_candidates').update({ status }).eq('id', id);
    if (error) throw error;
  }

  async confirmPlaceCandidate(candidate: any, dayId: string) {
    const { data: place, error: placeError } = await this.db.from('places').insert({ name: candidate.name, city: candidate.city, category: candidate.category, provider: 'manual' }).select().single();
    if (placeError) throw placeError;
    const { data: visit, error: visitError } = await this.db.from('place_visits').insert({ trip_day_id: dayId, place_id: place.id, category: candidate.category }).select().single();
    if (visitError) throw visitError;
    const { error } = await this.db.from('place_candidates').update({ status: 'confirmed', resolved_place_id: place.id }).eq('id', candidate.id);
    if (error) throw error;
    return visit;
  }

  async ratePlaceVisit(id: string, values: Record<string, unknown>) {
    const { error } = await this.db.from('place_visits').update(values).eq('id', id);
    if (error) throw error;
  }

  async uploadMedia(userId: string, tripId: string, dayId: string, file: File) {
    const extension = file.name.split('.').pop() || 'bin';
    const path = `${userId}/${tripId}/${dayId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await this.db.storage.from('trip-media').upload(path, file, { contentType: file.type });
    if (error) throw error;
    const { data, error: rowError } = await this.db.from('trip_media').insert({ trip_day_id: dayId, storage_path: path, media_type: file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'photo', original_name: file.name }).select().single();
    if (rowError) throw rowError;
    const { data: signed } = await this.db.storage.from('trip-media').createSignedUrl(path, 3600);
    return { ...data, url: signed?.signedUrl };
  }

  async media(dayId: string) {
    const { data, error } = await this.db.from('trip_media').select('*').eq('trip_day_id', dayId).order('created_at');
    if (error) throw error;
    return Promise.all((data ?? []).map(async item => {
      const { data: signed } = await this.db.storage.from('trip-media').createSignedUrl(item.storage_path, 3600);
      return { ...item, url: signed?.signedUrl };
    }));
  }

  async transcribe(storagePath: string) {
    const { data, error } = await this.db.functions.invoke('transcribe-day', { body: { storagePath } });
    if (error) throw error;
    return data.text as string;
  }

  async generateJournal(dayId: string, rawText: string, media: unknown[]) {
    const { data, error } = await this.db.functions.invoke('generate-journal', { body: { dayId, rawText, media } });
    if (error) throw error;
    return data;
  }

  async saveExpense(dayId: string, label: string, amount: number, currency: string) {
    const { error } = await this.db.from('expenses').insert({ trip_day_id: dayId, label, amount, currency });
    if (error) throw error;
  }
}

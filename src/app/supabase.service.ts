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
}

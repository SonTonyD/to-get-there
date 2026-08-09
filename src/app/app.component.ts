import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from './supabase.service';

type Screen = 'splash' | 'auth' | 'questionnaire' | 'home' | 'trips' | 'new-trip' | 'dashboard' | 'profile';
type AuthMode = 'login' | 'signup' | 'forgot';

interface TripDay { date: string; label: string; note: string; }
interface Trip {
  id: string; title: string; country: string; startDate: string; endDate: string;
  currency: string; budget: number | null; visibility: 'private' | 'public'; days: TripDay[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  screen: Screen = 'splash';
  authMode: AuthMode = 'signup';
  menuOpen = false;
  selectedTrip: Trip | null = null;
  toast = '';
  user = { email: '', username: '', firstname: '', bio: '', avatar: 'É' };
  auth = { email: '', password: '', username: '', firstname: '' };
  questionnaire = { personality: 'curieuse', anxiety: 2, noise: 2, crowd: 2, diet: '', allergies: '', mobility: '', notes: '' };
  tripForm = { title: 'Vietnam 2026', country: 'Vietnam', startDate: '2026-04-12', endDate: '2026-04-24', currency: 'EUR', budget: 2400 as number | null, visibility: 'private' as 'private' | 'public' };
  trips: Trip[] = [];

  constructor(private readonly supabase: SupabaseService) {}

  async ngOnInit() {
    if (!this.supabase.configured) return;
    const currentUser = await this.supabase.currentUser();
    if (currentUser) await this.loadAccount(currentUser.id, currentUser.email ?? '');
  }

  go(screen: Screen) { this.screen = screen; this.menuOpen = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  start() { this.go('auth'); }
  async submitAuth() {
    if (!this.supabase.configured) { this.notify('Ajoute d’abord tes clés Supabase dans environment.ts'); return; }
    if (this.authMode === 'forgot') {
      if (!this.auth.email) { this.notify('Indique ton adresse e-mail'); return; }
      try { await this.supabase.resetPassword(this.auth.email); this.notify('Lien de réinitialisation envoyé ✨'); }
      catch (error) { this.notify(this.errorMessage(error)); }
      return;
    }
    if (!this.auth.email || !this.auth.password) { this.notify('Complète les champs requis'); return; }
    try {
      if (this.authMode === 'signup') {
        const result = await this.supabase.signUp(this.auth.email, this.auth.password, this.auth.firstname, this.auth.username);
        if (!result.session) { this.authMode = 'login'; this.notify('Compte créé ! Confirme ton e-mail avant de te connecter.'); return; }
        this.user = { ...this.user, email: this.auth.email, username: this.auth.username, firstname: this.auth.firstname, avatar: (this.auth.firstname || 'É').charAt(0).toUpperCase() };
        this.go('questionnaire');
      } else {
        const result = await this.supabase.signIn(this.auth.email, this.auth.password);
        await this.loadAccount(result.user.id, result.user.email ?? this.auth.email);
      }
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  async saveQuestionnaire() {
    try {
      const currentUser = await this.requireUser();
      await this.supabase.saveTravelerProfile(currentUser.id, {
        personality: this.questionnaire.personality,
        anxiety_level: Number(this.questionnaire.anxiety),
        noise_sensitivity: Number(this.questionnaire.noise),
        crowd_sensitivity: Number(this.questionnaire.crowd),
        dietary_preferences: this.toList(this.questionnaire.diet),
        allergies: this.toList(this.questionnaire.allergies),
        mobility_preferences: this.questionnaire.mobility,
        answers_json: { notes: this.questionnaire.notes }, completed_at: new Date().toISOString()
      });
      this.notify('Ton cocon voyageur est prêt !'); this.go('home');
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  async createTrip() {
    if (!this.tripForm.title || !this.tripForm.country || !this.tripForm.startDate || !this.tripForm.endDate) { this.notify('Complète les informations essentielles'); return; }
    if (new Date(this.tripForm.endDate) < new Date(this.tripForm.startDate)) { this.notify('La date de retour doit suivre le départ'); return; }
    try {
      const currentUser = await this.requireUser();
      const data = await this.supabase.createTrip({ owner_id: currentUser.id, title: this.tripForm.title, country: this.tripForm.country, start_date: this.tripForm.startDate, end_date: this.tripForm.endDate, currency: this.tripForm.currency, planned_budget: this.tripForm.budget, visibility: this.tripForm.visibility });
      const trip = this.mapTrip(data); this.trips.unshift(trip); this.openTrip(trip); this.notify('Voyage créé, l’aventure commence !');
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  openTrip(trip: Trip) { this.selectedTrip = trip; this.go('dashboard'); }
  async deleteTrip(trip: Trip) {
    if (!confirm(`Supprimer « ${trip.title} » ?`)) return;
    try { await this.supabase.deleteTrip(trip.id); this.trips = this.trips.filter(t => t.id !== trip.id); this.go('trips'); this.notify('Voyage supprimé'); }
    catch (error) { this.notify(this.errorMessage(error)); }
  }
  async saveProfile() {
    try { const currentUser = await this.requireUser(); await this.supabase.saveProfile(currentUser.id, { username: this.user.username, firstname: this.user.firstname, bio: this.user.bio }); this.user.avatar = (this.user.firstname || 'V').charAt(0).toUpperCase(); this.notify('Profil mis à jour'); }
    catch (error) { this.notify(this.errorMessage(error)); }
  }
  async logout() { try { await this.supabase.signOut(); } catch {} this.screen = 'splash'; this.selectedTrip = null; this.trips = []; this.notify('À bientôt, belle exploratrice !'); }
  private notify(message: string) { this.toast = message; setTimeout(() => this.toast = '', 2800); }
  formatDate(date: string) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date + 'T12:00:00')); }
  formatMoney(value: number | null, currency: string) { return value == null ? 'À définir' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }

  private async loadAccount(userId: string, email: string) {
    try {
      const [profile, traveler, trips] = await Promise.all([this.supabase.profile(userId), this.supabase.travelerProfile(userId), this.supabase.trips(userId)]);
      this.user = { email, username: profile.username, firstname: profile.firstname, bio: profile.bio ?? '', avatar: (profile.firstname || 'V').charAt(0).toUpperCase() };
      if (traveler) this.questionnaire = { personality: traveler.personality ?? 'curieuse', anxiety: traveler.anxiety_level ?? 2, noise: traveler.noise_sensitivity ?? 2, crowd: traveler.crowd_sensitivity ?? 2, diet: (traveler.dietary_preferences ?? []).join(', '), allergies: (traveler.allergies ?? []).join(', '), mobility: traveler.mobility_preferences ?? '', notes: traveler.answers_json?.notes ?? '' };
      this.trips = trips.map(data => this.mapTrip(data)); this.go(traveler?.completed_at ? 'home' : 'questionnaire');
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  private mapTrip(data: any): Trip { return { id: data.id, title: data.title, country: data.country, startDate: data.start_date, endDate: data.end_date, currency: data.currency, budget: data.planned_budget == null ? null : Number(data.planned_budget), visibility: data.visibility, days: (data.trip_days ?? []).sort((a: any, b: any) => a.day_number - b.day_number).map((day: any) => ({ date: day.day_date, label: `Jour ${day.day_number}`, note: day.notes ?? '' })) }; }
  private async requireUser() { const user = await this.supabase.currentUser(); if (!user) throw new Error('Ta session a expiré, reconnecte-toi.'); return user; }
  private toList(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean); }
  private errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Une erreur est survenue avec Supabase.'; }
}

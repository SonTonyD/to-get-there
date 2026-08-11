import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from './supabase.service';
import * as L from 'leaflet';

type Screen = 'splash' | 'auth' | 'questionnaire' | 'home' | 'trips' | 'new-trip' | 'dashboard' | 'journal' | 'explore' | 'public-trip' | 'reader' | 'profile';
type AuthMode = 'login' | 'signup' | 'forgot';

interface TripDay { id?: string; date: string; label: string; note: string; }
interface Trip {
  id: string; title: string; country: string; startDate: string; endDate: string;
  currency: string; budget: number | null; visibility: 'private' | 'public'; days: TripDay[]; coverUrl?: string;
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
  selectedDay: TripDay | null = null;
  journal = { title: '', summary: '', rawText: '', layout: 'scrapbook', coverMediaId: '', status: 'draft', events: [] as any[], places: [] as any[] };
  journalEditing = false;
  journalMedia: any[] = [];
  generating = false;
  recording = false;
  expense = { label: '', amount: null as number | null, convertedAmount: null as number | null, currency: 'EUR', category: 'Restauration' };
  expenses: any[] = []; placeVisits: any[] = []; tripStats: any = null;
  publication = { photos: true, story: true, recommendations: true, budget: false, design: 'scrapbook' };
  exploreSearch = ''; publicTrips: any[] = []; selectedPublicTrip: any = null;
  readerPages: any[] = []; readerIndex = 0; readerOrigin: Screen = 'dashboard'; readerTrip: any = null;
  private map?: L.Map;
  private recorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private autosaveTimer?: ReturnType<typeof setTimeout>;

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
  openTrip(trip: Trip) { this.selectedTrip = trip; this.go('dashboard'); this.loadTripInsights(); }
  async loadTripInsights() { if (!this.selectedTrip) return; try { [this.expenses,this.placeVisits,this.tripStats] = await Promise.all([this.supabase.expenses(this.selectedTrip.id),this.supabase.placeVisits(this.selectedTrip.id),this.supabase.tripStatistics(this.selectedTrip.id)]); setTimeout(()=>this.renderMap(),0); } catch (error) { this.notify(this.errorMessage(error)); } }
  private renderMap() { const element=document.getElementById('trip-map'); if (!element) return; this.map?.remove(); const points=this.placeVisits.filter(v=>v.places?.latitude!=null&&v.places?.longitude!=null); this.map=L.map(element).setView(points.length?[points[0].places.latitude,points[0].places.longitude]:[16.05,108.2],points.length?7:5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(this.map); const bounds:L.LatLngExpression[]=[]; points.forEach(visit=>{const point:[number,number]=[visit.places.latitude,visit.places.longitude];bounds.push(point);const marker=L.circleMarker(point,{radius:9,color:'#76529a',fillColor:'#c8b6ff',fillOpacity:.9}).addTo(this.map!).bindTooltip(`${visit.places.name} · ${visit.places.city??''}`);marker.on('click',()=>{const day=this.selectedTrip?.days.find(item=>item.id===visit.trip_day_id);if(day)this.openJournal(day)});});if(bounds.length>1)this.map.fitBounds(L.latLngBounds(bounds),{padding:[30,30]}); }
  async openJournal(day: TripDay) {
    if (!day.id) { this.notify('Cette journée doit être synchronisée avec Supabase.'); return; }
    this.selectedDay = day; this.expense.currency = this.selectedTrip?.currency ?? 'EUR'; this.journalEditing=false; this.journal = { title: '', summary: '', rawText: '', layout: 'scrapbook', coverMediaId: '', status: 'draft', events: [], places: [] }; this.journalMedia = []; this.go('journal');
    try {
      const [saved, media] = await Promise.all([this.supabase.journal(day.id), this.supabase.media(day.id)]);
      this.journalMedia = media;
      if (saved) this.journal = { title: saved.title ?? '', summary: saved.summary ?? '', rawText: saved.raw_text ?? '', layout: 'scrapbook', coverMediaId: saved.cover_media_id ?? '', status: saved.status ?? 'draft', events: (saved.journal_events ?? []).sort((a: any,b: any) => a.event_order-b.event_order), places: saved.place_candidates ?? [] };
      if (!this.journal.coverMediaId) this.journal.coverMediaId = this.photoMedia[0]?.id ?? '';
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  async addMedia(event: Event) {
    const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []);
    if (!this.selectedTrip || !this.selectedDay?.id || !files.length) return;
    try { const user = await this.requireUser(); for (const file of files) this.journalMedia.push(await this.supabase.uploadMedia(user.id, this.selectedTrip.id, this.selectedDay.id, file)); if (!this.journal.coverMediaId && this.photoMedia[0]) await this.selectCover(this.photoMedia[0]); else this.scheduleAutosave(); this.notify(`${files.length} média${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}`); }
    catch (error) { this.notify(this.errorMessage(error)); } finally { input.value = ''; }
  }
  async toggleRecording() {
    if (this.recording) { this.recorder?.stop(); this.recording = false; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.audioChunks = [];
      this.recorder = new MediaRecorder(stream); this.recorder.ondataavailable = e => this.audioChunks.push(e.data);
      this.recorder.onstop = async () => { stream.getTracks().forEach(t => t.stop()); await this.processRecording(); };
      this.recorder.start(); this.recording = true;
    } catch { this.notify('Impossible d’accéder au microphone.'); }
  }
  private async processRecording() {
    if (!this.selectedTrip || !this.selectedDay?.id) return;
    try { this.generating = true; const user = await this.requireUser(); const file = new File([new Blob(this.audioChunks, { type: 'audio/webm' })], `recit-${Date.now()}.webm`, { type: 'audio/webm' }); const media = await this.supabase.uploadMedia(user.id, this.selectedTrip.id, this.selectedDay.id, file); this.journalMedia.push(media); this.journal.rawText = await this.supabase.transcribe(media.storage_path); this.scheduleAutosave(); this.notify('Ton récit a été retranscrit ✨'); }
    catch (error) { this.notify(this.errorMessage(error)); } finally { this.generating = false; }
  }
  async generateJournal() {
    if (!this.selectedDay?.id || !this.journal.rawText.trim()) { this.notify('Raconte ou écris d’abord ta journée.'); return; }
    try { this.generating = true; const result = await this.supabase.generateJournal(this.selectedDay.id, this.journal.rawText, this.journalMedia.map(m => ({ id: m.id, type: m.media_type, name: m.original_name }))); this.journal.title = result.title; this.journal.summary = result.summary; this.journal.events = result.events ?? []; this.journal.places = result.placeCandidates ?? []; this.journal.layout='scrapbook'; this.journalEditing=false; await this.saveJournal(false); this.notify('Ta journée de carnet est prête ✨'); }
    catch (error) { this.notify(this.errorMessage(error)); } finally { this.generating = false; }
  }
  scheduleAutosave() { clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => this.saveJournal(true), 900); }
  async saveJournal(silent = false) {
    if (!this.selectedDay?.id) return;
    try { await this.supabase.saveJournal(this.selectedDay.id, { title: this.journal.title, summary: this.journal.summary, raw_text: this.journal.rawText, layout: this.journal.layout, cover_media_id: this.journal.coverMediaId || null, status: this.journal.status }, this.journal.events); this.selectedDay.note = this.journal.summary || this.journal.title; if (!silent) this.notify('Brouillon enregistré'); }
    catch (error) { if (!silent) this.notify(this.errorMessage(error)); }
  }
  async confirmPlace(place: any, decision: boolean) { place.status = decision ? 'confirmed' : 'rejected'; try { if (!place.id) return; if (decision && this.selectedDay?.id) { const visit = await this.supabase.confirmPlaceCandidate(place, this.selectedDay.id); place.visitId = visit.id; } else await this.supabase.updatePlaceCandidate(place.id, 'rejected'); } catch (error) { place.status = 'pending'; this.notify(this.errorMessage(error)); } }
  async ratePlace(place: any, field: 'liked' | 'recommended', value: boolean) { place[field] = value; try { if (place.visitId) await this.supabase.ratePlaceVisit(place.visitId, { [field]: value }); } catch (error) { this.notify(this.errorMessage(error)); } }
  get photoMedia() { return this.journalMedia.filter(media => media.media_type === 'photo' && media.url); }
  get coverPhoto() { return this.photoMedia.find(media => media.id === this.journal.coverMediaId) ?? this.photoMedia[0] ?? null; }
  get galleryPhotos() { return this.photoMedia.filter(media => media.id !== this.coverPhoto?.id).slice(0, 3); }
  async selectCover(media: any) { this.journal.coverMediaId = media.id; if(this.selectedTrip){this.selectedTrip.coverUrl=media.url;try{await this.supabase.setTripCover(this.selectedTrip.id,media.storage_path)}catch(error){this.notify(this.errorMessage(error))}} this.scheduleAutosave(); }
  async addExpense() { if (!this.selectedTrip || !this.selectedDay?.id || !this.expense.label || !this.expense.amount) return; try { const converted=this.expense.currency===this.selectedTrip.currency?this.expense.amount:this.expense.convertedAmount;if(converted==null){this.notify(`Indique l’équivalent en ${this.selectedTrip.currency}`);return} await this.supabase.saveExpense(this.selectedTrip.id,this.selectedDay.id,{label:this.expense.label,amount:this.expense.amount,currency:this.expense.currency,convertedAmount:converted,convertedCurrency:this.selectedTrip.currency,category:this.expense.category,date:this.selectedDay.date}); this.expense = { label: '', amount: null, convertedAmount:null, currency:this.selectedTrip.currency, category:'Restauration' }; this.notify('Dépense ajoutée'); } catch (error) { this.notify(this.errorMessage(error)); } }
  get spentTotal(){return this.expenses.reduce((sum,e)=>sum+Number(e.converted_amount??e.amount),0)}
  get remainingBudget(){return (this.selectedTrip?.budget??0)-this.spentTotal}
  get dailyAverage(){return this.selectedTrip?.days.length?this.spentTotal/this.selectedTrip.days.length:0}
  categoryTotal(category:string){return this.expenses.filter(e=>e.category===category).reduce((sum,e)=>sum+Number(e.converted_amount??e.amount),0)}
  async completeTrip(){if(!this.selectedTrip)return;try{this.tripStats=await this.supabase.finishTrip(this.selectedTrip.id);this.notify('Voyage terminé · ta page en chiffres est prête !')}catch(error){this.notify(this.errorMessage(error))}}
  async publishTrip(){if(!this.selectedTrip)return;try{const slug=await this.supabase.publishTrip(this.selectedTrip.id,this.publication);this.notify(`Voyage publié : ${slug}`)}catch(error){this.notify(this.errorMessage(error))}}
  async openExplore(){this.go('explore');try{this.publicTrips=await this.supabase.explorePublicTrips()}catch(error){this.notify(this.errorMessage(error))}}
  get filteredPublicTrips(){const q=this.exploreSearch.trim().toLowerCase();return this.publicTrips.filter(item=>!q||item.snapshot?.trip?.country?.toLowerCase().includes(q)||item.snapshot?.trip?.title?.toLowerCase().includes(q)||item.snapshot?.places?.some((p:any)=>p.city?.toLowerCase().includes(q)))}
  get publicAuthorTrips(){const id=this.selectedPublicTrip?.author?.id;return this.publicTrips.filter(item=>item.snapshot?.author?.id===id)}
  get publicAuthorCountries(){return [...new Set(this.publicAuthorTrips.map(item=>item.snapshot.trip.country))]}
  exploreCountry(country:string){this.exploreSearch=country;this.openExplore()}
  openPublicTrip(item:any){this.selectedPublicTrip=item.snapshot;this.go('public-trip')}
  async openOwnerReader() { if (!this.selectedTrip) return; try { const days=await this.supabase.tripReader(this.selectedTrip.id); this.readerTrip={ title:this.selectedTrip.title,country:this.selectedTrip.country,startDate:this.selectedTrip.startDate,endDate:this.selectedTrip.endDate,author:this.user.firstname,design:'scrapbook',stats:this.tripStats }; this.readerPages=this.buildReaderPages(days.map((day:any)=>{const journal=day.day_journals?.[0]??day.day_journals??{};return{date:day.day_date,title:journal.title||day.label||`Jour ${day.day_number}`,summary:journal.summary||day.notes||'',layout:'scrapbook',events:(journal.journal_events??[]).sort((a:any,b:any)=>a.event_order-b.event_order).map((event:any)=>({time:event.event_time,title:event.title,description:event.description,place:event.place_text})),photos:(day.trip_media??[]).map((media:any)=>media.url).filter(Boolean)}}),this.readerTrip); this.readerOrigin='dashboard';this.readerIndex=0;this.go('reader'); } catch(error){this.notify(this.errorMessage(error))} }
  openPublicReader(){if(!this.selectedPublicTrip)return;const sourceDays=this.selectedPublicTrip.days??[];const allPhotos=(this.selectedPublicTrip.photos??[]).filter(Boolean);const legacyBuckets=sourceDays.map((_:any,index:number)=>allPhotos.filter((_:string,photoIndex:number)=>photoIndex%Math.max(sourceDays.length,1)===index));const days=sourceDays.map((day:any,index:number)=>({...day,layout:'scrapbook',photos:(this.selectedPublicTrip.photoDays?.[day.date]??legacyBuckets[index]??[]).filter(Boolean),events:day.events??[]}));this.readerTrip={...this.selectedPublicTrip.trip,author:this.selectedPublicTrip.author.firstname||this.selectedPublicTrip.author.username,design:'scrapbook',stats:this.selectedPublicTrip.stats};this.readerPages=this.buildReaderPages(days,this.readerTrip);this.readerOrigin='public-trip';this.readerIndex=0;this.go('reader')}
  private buildReaderPages(days:any[],trip:any){
    const usedTitles=new Set<string>();
    const tripTitle=String(trip.title??'').trim().toLocaleLowerCase('fr');
    const scrapbookDays=days.map((day,index)=>{
      const savedTitle=String(day.title??'').trim();
      const normalized=savedTitle.toLocaleLowerCase('fr');
      const repeated=!savedTitle||normalized===tripTitle||usedTitles.has(normalized);
      const eventTitle=String(day.events?.[0]?.title??'').trim();
      const title=repeated?(eventTitle||`Jour ${index+1}`):savedTitle;
      usedTitles.add(title.toLocaleLowerCase('fr'));
      return{kind:'day',number:index+1,...day,title,layout:'scrapbook'};
    });
    return[{kind:'cover',layout:'scrapbook',title:trip.title,country:trip.country,author:trip.author,photo:days.flatMap(day=>day.photos??[])[0]??null},{kind:'timeline',layout:'scrapbook',title:'Le fil du voyage',country:trip.country,days:scrapbookDays},...scrapbookDays,{kind:'end',layout:'scrapbook',title:`${trip.country} en chiffres`,stats:trip.stats??{},country:trip.country}];
  }
  get readerPage(){return this.readerPages[this.readerIndex]??null}
  readerNext(){if(this.readerIndex<this.readerPages.length-1)this.readerIndex++}
  readerPrevious(){if(this.readerIndex>0)this.readerIndex--}
  closeReader(){this.go(this.readerOrigin)}
  @HostListener('window:keydown',['$event']) onReaderKey(event:KeyboardEvent){if(this.screen!=='reader')return;if(event.key==='ArrowRight'||event.key===' ')this.readerNext();if(event.key==='ArrowLeft')this.readerPrevious();if(event.key==='Escape')this.closeReader()}
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
  private mapTrip(data: any): Trip { return { id: data.id, title: data.title, country: data.country, startDate: data.start_date, endDate: data.end_date, currency: data.currency, budget: data.planned_budget == null ? null : Number(data.planned_budget), visibility: data.visibility, coverUrl:data.cover_url, days: (data.trip_days ?? []).sort((a: any, b: any) => a.day_number - b.day_number).map((day: any) => ({ id: day.id, date: day.day_date, label: `Jour ${day.day_number}`, note: day.notes ?? '' })) }; }
  private async requireUser() { const user = await this.supabase.currentUser(); if (!user) throw new Error('Ta session a expiré, reconnecte-toi.'); return user; }
  private toList(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean); }
  private errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Une erreur est survenue avec Supabase.'; }
}

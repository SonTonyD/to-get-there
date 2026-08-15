import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from './supabase.service';
import * as L from 'leaflet';

type Screen = 'splash' | 'auth' | 'questionnaire' | 'home' | 'trips' | 'new-trip' | 'dashboard' | 'journal' | 'explore' | 'destination' | 'place' | 'public-trip' | 'public-profile' | 'inspirations' | 'inbox' | 'conversation' | 'community-settings' | 'reader' | 'profile';
type AuthMode = 'login' | 'signup' | 'forgot';
type TripTab = 'journal' | 'map' | 'budget' | 'settings';
type JournalStep = 1 | 2 | 3 | 4;

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
export class AppComponent implements OnInit, OnDestroy {
  screen: Screen = 'splash';
  authMode: AuthMode = 'signup';
  menuOpen = false;
  selectedTrip: Trip | null = null;
  toast = '';
  user = { email: '', username: '', firstname: '', bio: '', avatar: 'É' };
  userId = '';
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
  exploreSearch = ''; exploreDuration='all';exploreSeason='all';exploreType='all'; publicTrips: any[] = []; selectedPublicTrip: any = null;
  searchFilters={month:0,minDuration:null as number|null,maxDuration:null as number|null,maxBudget:null as number|null,tripType:'',category:'',recommendedOnly:false,recentOnly:false};
  searchResults:any={trips:[],destinations:[],places:[],parsed:{}};searchPerformed=false;destination:any=null;selectedPlace:any=null;
  tripFeedback={recommendDestination:'yes',recommendPeriod:true,recommendedDuration:null as number|null,adviceText:'',publishAdvice:false,showExactBudget:false,allowAnonymousStatistics:false};
  readonly months=['Tous les mois','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  readerPages: any[] = []; readerIndex = 0; readerOrigin: Screen = 'dashboard'; readerTrip: any = null;
  readerTocOpen=false;readerFullscreen=false;readerLightbox='';private readerTouchX=0;
  tripsLoading=false;exploreLoading=false;commentsLoading=false;inboxLoading=false;conversationLoading=false;messageSending=false;commentSending=false;
  autosaveState:'idle'|'pending'|'saving'|'saved'|'error'='idle';aiProgress=0;aiStage='';actionError:{scope:string;message:string}|null=null;private retryCallback:(()=>Promise<void>)|null=null;private aiProgressTimer?:ReturnType<typeof setInterval>;
  communityProfile:any=null; relationship:any={}; commentsList:any[]=[]; commentDraft=''; inspirationsList:any[]=[];
  publicLikeBusy=false;
  inboxList:any[]=[]; activeConversationId=''; messagesList:any[]=[]; messageDraft=''; friendRequests:any[]=[];
  activeConversationPeer:any=null; unreadMessageCount=0; pendingFriendCount=0;
  messagePermission:'everyone'|'following'|'friends'|'nobody'='everyone';
  tripTab:TripTab='journal'; journalStep:JournalStep=1;
  private map?: L.Map;
  private recorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private communityPollTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly supabase: SupabaseService) {}

  async ngOnInit() {
    if (!this.supabase.configured) return;
    const currentUser = await this.supabase.currentUser();
    if (currentUser) await this.loadAccount(currentUser.id, currentUser.email ?? '');
  }

  ngOnDestroy(){if(this.communityPollTimer)clearInterval(this.communityPollTimer)}

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
  openTrip(trip: Trip) { this.selectedTrip = trip; this.tripTab='journal';this.go('dashboard'); this.loadTripInsights(); }
  setTripTab(tab:TripTab){this.tripTab=tab;if(tab==='map')setTimeout(()=>this.renderMap(),0)}
  setJournalStep(step:JournalStep){if(step===4&&!this.journal.title&&!this.journal.events.length){this.notify('Génère d’abord ta journée.');return}this.journalStep=step;window.scrollTo({top:0,behavior:'smooth'})}
  async loadTripInsights() { if (!this.selectedTrip) return; try { [this.expenses,this.placeVisits,this.tripStats] = await Promise.all([this.supabase.expenses(this.selectedTrip.id),this.supabase.placeVisits(this.selectedTrip.id),this.supabase.tripStatistics(this.selectedTrip.id)]); setTimeout(()=>this.renderMap(),0); } catch (error) { this.notify(this.errorMessage(error)); } }
  private renderMap() { const element=document.getElementById('trip-map'); if (!element) return; this.map?.remove(); const points=this.placeVisits.filter(v=>v.places?.latitude!=null&&v.places?.longitude!=null); this.map=L.map(element).setView(points.length?[points[0].places.latitude,points[0].places.longitude]:[16.05,108.2],points.length?7:5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(this.map); const bounds:L.LatLngExpression[]=[]; points.forEach(visit=>{const point:[number,number]=[visit.places.latitude,visit.places.longitude];bounds.push(point);const marker=L.circleMarker(point,{radius:9,color:'#76529a',fillColor:'#c8b6ff',fillOpacity:.9}).addTo(this.map!).bindTooltip(`${visit.places.name} · ${visit.places.city??''}`);marker.on('click',()=>{const day=this.selectedTrip?.days.find(item=>item.id===visit.trip_day_id);if(day)this.openJournal(day)});});if(bounds.length>1)this.map.fitBounds(L.latLngBounds(bounds),{padding:[30,30]}); }
  async openJournal(day: TripDay) {
    if (!day.id) { this.notify('Cette journée doit être synchronisée avec Supabase.'); return; }
    this.selectedDay = day; this.expense.currency = this.selectedTrip?.currency ?? 'EUR'; this.journalEditing=false;this.journalStep=1; this.journal = { title: '', summary: '', rawText: '', layout: 'scrapbook', coverMediaId: '', status: 'draft', events: [], places: [] }; this.journalMedia = []; this.go('journal');
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
    try { this.generating = true;this.clearActionError('ai');this.aiProgress=18;this.aiStage='Transcription terminée';const stages=[{at:35,label:'Événements identifiés'},{at:58,label:'Lieux détectés'},{at:78,label:'Carnet en création'}];this.aiProgressTimer=setInterval(()=>{this.aiProgress=Math.min(this.aiProgress+4,88);const stage=[...stages].reverse().find(item=>this.aiProgress>=item.at);if(stage)this.aiStage=stage.label},500); const result = await this.supabase.generateJournal(this.selectedDay.id, this.journal.rawText, this.journalMedia.map(m => ({ id: m.id, type: m.media_type, name: m.original_name }))); this.journal.title = result.title; this.journal.summary = result.summary; this.journal.events = result.events ?? []; this.journal.places = result.placeCandidates ?? []; this.journal.layout='scrapbook'; this.journalEditing=false;this.aiProgress=100;this.aiStage='Carnet prêt'; await this.saveJournal(false);this.journalStep=3;window.scrollTo({top:0,behavior:'smooth'}); this.notify('Ta journée est prête · vérifie maintenant les lieux ✨'); }
    catch (error) { this.setActionError('ai',this.errorMessage(error),()=>this.generateJournal()); } finally { if(this.aiProgressTimer)clearInterval(this.aiProgressTimer);this.aiProgressTimer=undefined;this.generating = false; }
  }
  scheduleAutosave() { this.autosaveState='pending';clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => this.saveJournal(true), 900); }
  async saveJournal(silent = false) {
    if (!this.selectedDay?.id) return;
    try { this.autosaveState='saving';await this.supabase.saveJournal(this.selectedDay.id, { title: this.journal.title, summary: this.journal.summary, raw_text: this.journal.rawText, layout: this.journal.layout, cover_media_id: this.journal.coverMediaId || null, status: this.journal.status }, this.journal.events); this.selectedDay.note = this.journal.summary || this.journal.title;this.autosaveState='saved'; if (!silent) this.notify('Brouillon enregistré'); }
    catch (error) { this.autosaveState='error';this.setActionError('autosave',this.errorMessage(error),()=>this.saveJournal(silent));if (!silent) this.notify(this.errorMessage(error)); }
  }
  async confirmPlace(place: any, decision: boolean) {
    if (!place.id) return;
    if (!decision) { place.status='rejected'; try { await this.supabase.updatePlaceCandidate(place.id,'rejected'); } catch(error){place.status='pending';this.notify(this.errorMessage(error))} return; }
    try { place.resolving=true; place.matches=await this.supabase.resolvePlace(place,this.selectedTrip?.country??''); if(!place.matches.length)this.notify('Aucun lieu correspondant trouvé. Essaie de préciser son nom ou sa ville.'); }
    catch(error){this.notify(this.errorMessage(error))} finally {place.resolving=false}
  }
  async choosePlace(place:any,match:any){if(!this.selectedDay?.id)return;try{place.resolving=true;const result=await this.supabase.confirmPlaceCandidate(place,match,this.selectedDay.id);place.status='confirmed';place.visitId=result.visit.id;place.latitude=match.latitude;place.longitude=match.longitude;place.city=match.city;place.matches=[];this.notify('Lieu confirmé · il apparaîtra sur la carte ✦')}catch(error){this.notify(this.errorMessage(error))}finally{place.resolving=false}}
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
  async submitTripFeedback(){if(!this.selectedTrip)return;try{await this.supabase.saveTripFeedback(this.selectedTrip.id,this.tripFeedback);this.notify('Merci, ton expérience aidera les prochains voyageurs.')}catch(error){this.notify(this.errorMessage(error))}}
  async openExplore(){this.go('explore');this.exploreLoading=true;this.clearActionError('explore');try{this.publicTrips=await this.supabase.explorePublicTrips();await this.runTravelSearch(false);await Promise.all(this.publicTrips.map(async item=>{const id=item.snapshot?.trip?.id;if(id)Object.assign(item.snapshot,await this.supabase.tripEngagement(id))}))}catch(error){this.setActionError('explore',this.errorMessage(error),()=>this.openExplore())}finally{this.exploreLoading=false}}
  async runTravelSearch(mark=true){if(mark)this.searchPerformed=true;try{this.searchResults=await this.supabase.searchTravelBase({query:this.exploreSearch,...this.searchFilters})}catch(error){if(mark)this.setActionError('explore',this.errorMessage(error),()=>this.runTravelSearch())}}
  clearTravelFilters(){this.exploreSearch='';this.searchFilters={month:0,minDuration:null,maxDuration:null,maxBudget:null,tripType:'',category:'',recommendedOnly:false,recentOnly:false};void this.runTravelSearch()}
  async openDestination(item:any){this.exploreLoading=true;try{this.destination=await this.supabase.destinationDetails(item.id);this.go('destination')}catch(error){this.notify(this.errorMessage(error))}finally{this.exploreLoading=false}}
  async openPlace(item:any){this.exploreLoading=true;try{this.selectedPlace=await this.supabase.placeDetails(item.id);this.go('place')}catch(error){this.notify(this.errorMessage(error))}finally{this.exploreLoading=false}}
  monthBar(value:number,total:number){return Math.max(3,Math.round((Number(value||0)/Math.max(1,total))*100))}
  searchTripPublication(tripId:string){return this.publicTrips.find(item=>item.snapshot?.trip?.id===tripId)}
  tripDuration(item:any){return Number(item.snapshot?.stats?.days??item.snapshot?.days?.length??0)}
  tripSeason(item:any){const month=new Date(item.snapshot?.trip?.startDate??'').getMonth()+1;return[12,1,2].includes(month)?'winter':[3,4,5].includes(month)?'spring':[6,7,8].includes(month)?'summer':'autumn'}
  tripType(item:any){const cities=new Set((item.snapshot?.places??[]).map((place:any)=>place.city).filter(Boolean)).size;return cities>=3?'roadtrip':this.tripDuration(item)<=5?'city':'slow'}
  tripCities(item:any){return[...new Set((item.snapshot?.places??[]).map((place:any)=>place.city).filter(Boolean))].slice(0,3) as string[]}
  recommendationCount(item:any){return(item.snapshot?.places??[]).filter((place:any)=>place.recommended).length}
  get filteredPublicTrips(){if(this.searchPerformed){const ids=new Set((this.searchResults.trips??[]).map((trip:any)=>trip.trip_id));return this.publicTrips.filter(item=>ids.has(item.snapshot?.trip?.id))}const q=this.exploreSearch.trim().toLowerCase();return this.publicTrips.filter(item=>!q||item.snapshot?.trip?.country?.toLowerCase().includes(q)||item.snapshot?.trip?.title?.toLowerCase().includes(q)||item.snapshot?.places?.some((p:any)=>p.city?.toLowerCase().includes(q)))}
  async toggleExploreSave(event:Event,item:any){event.stopPropagation();const tripId=item.snapshot?.trip?.id;if(!tripId)return;try{await this.supabase.toggleSaveTrip(tripId,!!item.snapshot.saved);item.snapshot.saved=!item.snapshot.saved;this.notify(item.snapshot.saved?'Voyage enregistré':'Voyage retiré des inspirations')}catch(error){this.notify(this.errorMessage(error))}}
  get publicAuthorTrips(){const id=this.selectedPublicTrip?.author?.id;return this.publicTrips.filter(item=>item.snapshot?.author?.id===id)}
  get publicAuthorCountries(){return [...new Set(this.publicAuthorTrips.map(item=>item.snapshot.trip.country))]}
  exploreCountry(country:string){this.exploreSearch=country;this.openExplore()}
  async openPublicTrip(item:any){if(!item?.snapshot){this.notify('Ce carnet n’est plus disponible.');return}this.selectedPublicTrip=item.snapshot;this.go('public-trip');await this.loadPublicInteractions()}
  async loadPublicInteractions(){
    const tripId=this.selectedPublicTrip?.trip?.id;
    if(!tripId)return;
    this.commentsLoading=true;this.clearActionError('comments');
    const[commentsResult,engagementResult]=await Promise.allSettled([this.supabase.comments('trip',tripId),this.supabase.tripEngagement(tripId)]);
    if(commentsResult.status==='fulfilled')this.commentsList=commentsResult.value;else this.setActionError('comments',this.errorMessage(commentsResult.reason),()=>this.loadPublicInteractions());
    if(engagementResult.status==='fulfilled')Object.assign(this.selectedPublicTrip,engagementResult.value);else this.notify(this.errorMessage(engagementResult.reason));
    this.commentsLoading=false;
  }
  async togglePublicLike(){const tripId=this.selectedPublicTrip?.trip?.id;if(!tripId||this.publicLikeBusy)return;this.publicLikeBusy=true;try{await this.supabase.toggleLike('trip',tripId,!!this.selectedPublicTrip.liked);const engagement=await this.supabase.tripEngagement(tripId);Object.assign(this.selectedPublicTrip,engagement)}catch(error){this.notify(this.errorMessage(error))}finally{this.publicLikeBusy=false}}
  async openCommunityProfile(userId:string){try{this.communityProfile=await this.supabase.communityProfile(userId);this.relationship=await this.supabase.relationship(userId);this.go('public-profile')}catch(error){this.notify(this.errorMessage(error))}}
  async toggleFollow(){if(!this.communityProfile)return;try{await this.supabase.toggleFollow(this.communityProfile.profile.id,this.relationship.following);this.relationship.following=!this.relationship.following;this.communityProfile.followers+=this.relationship.following?1:-1}catch(error){this.notify(this.errorMessage(error))}}
  async requestFriend(){try{await this.supabase.requestFriend(this.communityProfile.profile.id);this.relationship.friendship={status:'pending'};this.notify('Demande d’amitié envoyée')}catch(error){this.notify(this.errorMessage(error))}}
  async addPublicComment(){const tripId=this.selectedPublicTrip?.trip?.id;if(!tripId||!this.commentDraft.trim()||this.commentSending)return;const content=this.commentDraft.trim();this.commentSending=true;this.clearActionError('comments');try{await this.supabase.addComment('trip',tripId,content);this.commentDraft='';await this.loadPublicInteractions()}catch(error){this.setActionError('comments',this.errorMessage(error),()=>this.addPublicComment())}finally{this.commentSending=false}}
  async removeComment(id:string){try{await this.supabase.deleteComment(id);await this.loadPublicInteractions()}catch(error){this.notify(this.errorMessage(error))}}
  async toggleSave(){const tripId=this.selectedPublicTrip?.trip?.id;if(!tripId)return;try{await this.supabase.toggleSaveTrip(tripId,!!this.selectedPublicTrip.saved);this.selectedPublicTrip.saved=!this.selectedPublicTrip.saved;this.notify(this.selectedPublicTrip.saved?'Voyage ajouté aux inspirations':'Voyage retiré')}catch(error){this.notify(this.errorMessage(error))}}
  async openInspirations(){this.go('inspirations');try{this.inspirationsList=await this.supabase.inspirations()}catch(error){this.notify(this.errorMessage(error))}}
  async startChat(userId?:string){const target=userId??this.selectedPublicTrip?.author?.id;if(!target)return;if(target===this.userId){this.notify('Tu ne peux pas démarrer une conversation avec toi-même.');return}try{this.activeConversationId=await this.supabase.startConversation(target);await this.openConversation(this.activeConversationId)}catch(error){this.notify(this.communityErrorMessage(error))}}
  conversationPeer(item:any){return item?.conversation?.members?.find((member:any)=>member.user_id!==this.userId)?.profile??null}
  conversationUnread(item:any){return item?.conversation?.messages?.filter((message:any)=>message.sender_id!==this.userId&&!message.read).length??0}
  async refreshCommunityAlerts(announce=false){try{const[inbox,requests]=await Promise.all([this.supabase.inbox(),this.supabase.friendshipRequests()]);const unread=inbox.reduce((total,item)=>total+this.conversationUnread(item),0);if(announce&&unread>this.unreadMessageCount)this.notify('Tu as reçu un nouveau message ✉');else if(announce&&requests.length>this.pendingFriendCount)this.notify('Nouvelle demande d’amitié ✦');this.inboxList=inbox;this.friendRequests=requests;this.unreadMessageCount=unread;this.pendingFriendCount=requests.length}catch(error){if(!announce)throw error}}
  private startCommunityPolling(){if(this.communityPollTimer)clearInterval(this.communityPollTimer);void this.refreshCommunityAlerts();this.communityPollTimer=setInterval(()=>void this.refreshCommunityAlerts(true),20000)}
  async openInbox(){this.go('inbox');this.inboxLoading=true;this.clearActionError('inbox');try{await this.refreshCommunityAlerts()}catch(error){this.setActionError('inbox',this.errorMessage(error),()=>this.openInbox())}finally{this.inboxLoading=false}}
  async openConversation(id:string){this.activeConversationId=id;this.conversationLoading=true;this.clearActionError('messages');if(!this.inboxList.some(item=>item.conversation_id===id))await this.refreshCommunityAlerts();const item=this.inboxList.find(entry=>entry.conversation_id===id);this.activeConversationPeer=this.conversationPeer(item);this.go('conversation');try{this.messagesList=await this.supabase.conversation(id);await this.supabase.markConversationRead(id);await this.refreshCommunityAlerts()}catch(error){this.setActionError('messages',this.errorMessage(error),()=>this.openConversation(id))}finally{this.conversationLoading=false}}
  async sendChat(){if(!this.messageDraft.trim()||this.messageSending)return;const content=this.messageDraft.trim();this.messageSending=true;this.clearActionError('messages');try{await this.supabase.sendMessage(this.activeConversationId,content);this.messageDraft='';this.messagesList=await this.supabase.conversation(this.activeConversationId)}catch(error){this.setActionError('messages',this.errorMessage(error),()=>this.sendChat())}finally{this.messageSending=false}}
  async hideActiveConversation(){try{await this.supabase.hideConversation(this.activeConversationId);await this.openInbox()}catch(error){this.notify(this.errorMessage(error))}}
  async answerFriend(id:string,status:'accepted'|'rejected'){try{await this.supabase.answerFriendship(id,status);this.friendRequests=this.friendRequests.filter(item=>item.id!==id);this.pendingFriendCount=this.friendRequests.length}catch(error){this.notify(this.errorMessage(error))}}
  async blockProfile(){if(!this.communityProfile)return;if(!confirm('Bloquer cet utilisateur ?'))return;try{await this.supabase.blockUser(this.communityProfile.profile.id);this.relationship.blocked=true;this.notify('Utilisateur bloqué')}catch(error){this.notify(this.errorMessage(error))}}
  async reportTarget(type:'user'|'comment'|'message',id:string){const reason=prompt('Pourquoi souhaitez-vous signaler ce contenu ?');if(!reason)return;try{await this.supabase.report(type,id,reason);this.notify('Signalement transmis')}catch(error){this.notify(this.errorMessage(error))}}
  async updateMessagePermission(){try{await this.supabase.saveMessagePermission(this.messagePermission);this.notify('Préférence enregistrée')}catch(error){this.notify(this.errorMessage(error))}}
  async openOwnerReader() { if (!this.selectedTrip) return; try { const days=await this.supabase.tripReader(this.selectedTrip.id); this.readerTrip={ id:this.selectedTrip.id,title:this.selectedTrip.title,country:this.selectedTrip.country,startDate:this.selectedTrip.startDate,endDate:this.selectedTrip.endDate,author:this.user.firstname,design:'scrapbook',stats:this.tripStats }; this.readerPages=this.buildReaderPages(days.map((day:any)=>{const journal=day.day_journals?.[0]??day.day_journals??{};return{date:day.day_date,title:journal.title||day.label||`Jour ${day.day_number}`,summary:journal.summary||day.notes||'',layout:'scrapbook',events:(journal.journal_events??[]).sort((a:any,b:any)=>a.event_order-b.event_order).map((event:any)=>({time:event.event_time,title:event.title,description:event.description,place:event.place_text})),photos:(day.trip_media??[]).map((media:any)=>media.url).filter(Boolean)}}),this.readerTrip); this.readerOrigin='dashboard';this.restoreReaderPosition();this.go('reader'); } catch(error){this.notify(this.errorMessage(error))} }
  openPublicReader(){if(!this.selectedPublicTrip)return;const sourceDays=this.selectedPublicTrip.days??[];const allPhotos=(this.selectedPublicTrip.photos??[]).filter(Boolean);const legacyBuckets=sourceDays.map((_:any,index:number)=>allPhotos.filter((_:string,photoIndex:number)=>photoIndex%Math.max(sourceDays.length,1)===index));const days=sourceDays.map((day:any,index:number)=>({...day,layout:'scrapbook',photos:(this.selectedPublicTrip.photoDays?.[day.date]??legacyBuckets[index]??[]).filter(Boolean),events:day.events??[]}));this.readerTrip={...this.selectedPublicTrip.trip,author:this.selectedPublicTrip.author.firstname||this.selectedPublicTrip.author.username,design:'scrapbook',stats:this.selectedPublicTrip.stats};this.readerPages=this.buildReaderPages(days,this.readerTrip);this.readerOrigin='public-trip';this.restoreReaderPosition();this.go('reader')}
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
      return{kind:'day',number:index+1,...day,title,layout:'scrapbook',composition:['polaroid','postcard','ticket','contact'][index%4]};
    });
    return[{kind:'cover',layout:'scrapbook',title:trip.title,country:trip.country,author:trip.author,photo:days.flatMap(day=>day.photos??[])[0]??null},{kind:'timeline',layout:'scrapbook',title:'Le fil du voyage',country:trip.country,days:scrapbookDays},...scrapbookDays,{kind:'end',layout:'scrapbook',title:`${trip.country} en chiffres`,stats:trip.stats??{},country:trip.country}];
  }
  get readerPage(){return this.readerPages[this.readerIndex]??null}
  private readerStorageKey(){return`reader-position-${this.readerTrip?.id??this.readerTrip?.title??'trip'}`}
  private restoreReaderPosition(){const saved=Number(localStorage.getItem(this.readerStorageKey())??0);this.readerIndex=Number.isFinite(saved)&&saved>=0&&saved<this.readerPages.length?saved:0}
  goToReaderPage(index:number){if(index<0||index>=this.readerPages.length)return;this.readerIndex=index;this.readerTocOpen=false;localStorage.setItem(this.readerStorageKey(),String(index))}
  readerNext(){this.goToReaderPage(this.readerIndex+1)}
  readerPrevious(){this.goToReaderPage(this.readerIndex-1)}
  readerTouchStart(event:TouchEvent){this.readerTouchX=event.changedTouches[0]?.clientX??0}
  readerTouchEnd(event:TouchEvent){const delta=(event.changedTouches[0]?.clientX??0)-this.readerTouchX;if(Math.abs(delta)>55)(delta<0?this.readerNext():this.readerPrevious())}
  async toggleReaderFullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();this.readerFullscreen=!!document.fullscreenElement}catch{this.notify('Le plein écran n’est pas disponible sur cet appareil.')}}
  async shareReaderDay(){const page=this.readerPage;if(page?.kind!=='day')return;const text=`${page.title} · Jour ${page.number} de ${this.readerTrip?.title}`;try{if(navigator.share)await navigator.share({title:page.title,text,url:location.href});else{await navigator.clipboard.writeText(`${text} ${location.href}`);this.notify('Lien de la journée copié')}}catch{}}
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
  async logout() { if(this.communityPollTimer){clearInterval(this.communityPollTimer);this.communityPollTimer=undefined}try { await this.supabase.signOut(); } catch {} this.screen = 'splash'; this.selectedTrip = null; this.trips = []; this.inboxList=[];this.friendRequests=[];this.unreadMessageCount=0;this.pendingFriendCount=0;this.notify('À bientôt, belle exploratrice !'); }
  private notify(message: string) { this.toast = message; setTimeout(() => this.toast = '', 2800); }
  private setActionError(scope:string,message:string,retry:()=>Promise<void>){this.actionError={scope,message};this.retryCallback=retry}
  private clearActionError(scope:string){if(this.actionError?.scope===scope){this.actionError=null;this.retryCallback=null}}
  async retryLastAction(){const retry=this.retryCallback;if(!retry)return;this.actionError=null;this.retryCallback=null;await retry()}
  formatDate(date: string) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date + 'T12:00:00')); }
  formatMoney(value: number | null, currency: string) { return value == null ? 'À définir' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }

  private async loadAccount(userId: string, email: string) {
    try {
      this.userId=userId;
      const [profile, traveler, trips] = await Promise.all([this.supabase.profile(userId), this.supabase.travelerProfile(userId), this.supabase.trips(userId)]);
      this.user = { email, username: profile.username, firstname: profile.firstname, bio: profile.bio ?? '', avatar: (profile.firstname || 'V').charAt(0).toUpperCase() };
      if (traveler) this.questionnaire = { personality: traveler.personality ?? 'curieuse', anxiety: traveler.anxiety_level ?? 2, noise: traveler.noise_sensitivity ?? 2, crowd: traveler.crowd_sensitivity ?? 2, diet: (traveler.dietary_preferences ?? []).join(', '), allergies: (traveler.allergies ?? []).join(', '), mobility: traveler.mobility_preferences ?? '', notes: traveler.answers_json?.notes ?? '' };
      this.trips = trips.map(data => this.mapTrip(data)); this.go(traveler?.completed_at ? 'home' : 'questionnaire');
      this.startCommunityPolling();
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  private mapTrip(data: any): Trip { return { id: data.id, title: data.title, country: data.country, startDate: data.start_date, endDate: data.end_date, currency: data.currency, budget: data.planned_budget == null ? null : Number(data.planned_budget), visibility: data.visibility, coverUrl:data.cover_url, days: (data.trip_days ?? []).sort((a: any, b: any) => a.day_number - b.day_number).map((day: any) => ({ id: day.id, date: day.day_date, label: `Jour ${day.day_number}`, note: day.notes ?? '' })) }; }
  private async requireUser() { const user = await this.supabase.currentUser(); if (!user) throw new Error('Ta session a expiré, reconnecte-toi.'); return user; }
  private toList(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean); }
  private errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Une erreur est survenue avec Supabase.'; }
  private communityErrorMessage(error:unknown){const message=this.errorMessage(error);const errors:Record<string,string>={AUTH_REQUIRED:'Reconnecte-toi pour envoyer un message.',USER_NOT_FOUND:'Ce profil n’existe plus.',CANNOT_MESSAGE_SELF:'Tu ne peux pas t’écrire à toi-même.',USER_BLOCKED:'Cette interaction est impossible car un blocage est actif.',MESSAGES_DISABLED:'Cette personne n’accepte pas de nouveaux messages.',FOLLOW_REQUIRED:'Cette personne accepte uniquement les messages des voyageurs qu’elle suit.',FRIENDSHIP_REQUIRED:'Cette personne accepte uniquement les messages de ses amis.'};const code=Object.keys(errors).find(key=>message.includes(key));return code?errors[code]:message}
}

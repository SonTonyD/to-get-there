import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SupabaseService } from './supabase.service';
import * as L from 'leaflet';
import { VideoStudioComponent, VideoStudioConfig } from './video-studio.component';
import { BrowserVideoRendererService, BrowserVideoProgress } from './browser-video-renderer.service';
import { AppNavigationService, AppRouteState, AppScreen, NavigationContext } from './app-navigation.service';
import { TravelReaderComponent } from './features/reader/travel-reader.component';
import { buildSignatureReaderPages } from './features/reader/reader-pages';
import { MessagingDomainComponent } from './features/messaging/messaging-domain.component';
import { buildTripDayProgress, DayProgress } from './features/trips/trip-progress';

type Screen = AppScreen;
type AuthMode = 'login' | 'signup' | 'forgot';
type TripTab = 'journal' | 'map' | 'budget' | 'settings';
type JournalStep = 1 | 2 | 3 | 4;
type MessagingMode = 'inbox'|'conversation'|'settings';

interface TripDay { id?: string; date: string; label: string; note: string; }
interface Trip {
  id: string; title: string; country: string; startDate: string; endDate: string;
  currency: string; budget: number | null; visibility: 'private' | 'public'; days: TripDay[]; coverUrl?: string;
}
interface ScrapbookDesign { style:'wanderlust'|'retro'|'botanical'|'nocturne';palette:'candy'|'sunset'|'ocean'|'forest'|'mono'|'lavender';paper:'grid'|'kraft'|'floral'|'clean';composition:'collage'|'polaroid'|'postcard'|'filmstrip';font:'handwritten'|'editorial'|'typewriter';decorations:'minimal'|'balanced'|'maximal';customAccent:string;customPaper:string; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, VideoStudioComponent, TravelReaderComponent, MessagingDomainComponent],
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
  travelerCompleted=false;
  auth = { email: '', password: '', username: '', firstname: '' };
  questionnaire = { personality: 'curieuse', anxiety: 2, noise: 2, crowd: 2, diet: '', allergies: '', mobility: '', notes: '' };
  tripForm = { title: 'Vietnam 2026', country: 'Vietnam', startDate: '2026-04-12', endDate: '2026-04-24', currency: 'EUR', budget: 2400 as number | null, visibility: 'private' as 'private' | 'public' };
  trips: Trip[] = [];
  selectedDay: TripDay | null = null;
  journal = { title: '', summary: '', rawText: '', layout: 'scrapbook', coverMediaId: '', status: 'draft', design: this.defaultScrapbookDesign(), events: [] as any[], places: [] as any[] };
  designPanelOpen=true;
  journalEditing = false;
  journalMedia: any[] = [];
  generating = false;
  recording = false;
  expense = { label: '', amount: null as number | null, convertedAmount: null as number | null, currency: 'EUR', category: 'Restauration' };
  editingExpenseId='';expenseSaving=false;
  expenses: any[] = []; placeVisits: any[] = []; tripStats: any = null;
  tripCommandCenter:any=null;dayProgress:DayProgress[]=[];
  publication = { photos: true, story: true, recommendations: true, budget: false, design: 'scrapbook' };
  exploreSearch = ''; exploreDuration='all';exploreSeason='all';exploreType='all'; publicTrips: any[] = []; selectedPublicTrip: any = null;
  selectedPublicSlug='';publicProfileUsername='';activeDestinationId='';activePlaceId='';
  searchFilters={month:0,minDuration:null as number|null,maxDuration:null as number|null,maxBudget:null as number|null,tripType:'',category:'',recommendedOnly:false,recentOnly:false};
  searchResults:any={trips:[],destinations:[],places:[],parsed:{}};searchPerformed=false;destination:any=null;selectedPlace:any=null;
  tripFeedback={recommendDestination:'yes',recommendPeriod:true,recommendedDuration:null as number|null,adviceText:'',publishAdvice:false,showExactBudget:false,allowAnonymousStatistics:false};
  readonly months=['Tous les mois','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  readerPages: any[] = []; readerIndex = 0; readerOrigin: Screen = 'dashboard'; readerTrip: any = null;
  tripsLoading=false;exploreLoading=false;commentsLoading=false;inboxLoading=false;conversationLoading=false;messageSending=false;commentSending=false;
  googleAuthLoading=false;
  creatingTrip=false;uploadingMedia=false;uploadProgress='';completingTrip=false;publishingTrip=false;openingReader=false;publishProgress=0;publishStage='';publishedSlug='';private publishProgressTimer?:ReturnType<typeof setInterval>;
  autosaveState:'idle'|'pending'|'saving'|'saved'|'error'='idle';aiProgress=0;aiStage='';actionError:{scope:string;message:string}|null=null;private retryCallback:(()=>Promise<void>)|null=null;private aiProgressTimer?:ReturnType<typeof setInterval>;
  communityProfile:any=null; relationship:any={}; commentsList:any[]=[]; commentDraft=''; inspirationsList:any[]=[];
  publicLikeBusy=false;
  inboxList:any[]=[]; activeConversationId=''; messagesList:any[]=[]; messageDraft=''; friendRequests:any[]=[];
  activeConversationPeer:any=null; unreadMessageCount=0; pendingFriendCount=0;
  messagePermission:'everyone'|'following'|'friends'|'nobody'='everyone';
  get messagingMode():MessagingMode{return this.screen==='conversation'?'conversation':this.screen==='community-settings'?'settings':'inbox'}
  videoProject:any=null;videoMedia:any[]=[];videoExport:any=null;videoBusy='';videoError='';videoDay:TripDay|null=null;videoOrigin:Screen='dashboard';private videoObjectUrl='';
  tripTab:TripTab='journal'; journalStep:JournalStep=1;
  private map?: L.Map;
  private recorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private mediaCaptionTimer?: ReturnType<typeof setTimeout>;
  private communityPollTimer?: ReturnType<typeof setInterval>;
  private navigationSubscription?:Subscription;
  private routeReady=false;
  private applyingRoute=false;
  private readonly oauthReturnUrlKey='to-get-there.oauth-return-url';

  constructor(
    private readonly supabase: SupabaseService,
    readonly browserVideo: BrowserVideoRendererService,
    private readonly router:Router,
    private readonly navigation:AppNavigationService
  ) {}

  async ngOnInit() {
    this.navigationSubscription=this.router.events.pipe(filter((event):event is NavigationEnd=>event instanceof NavigationEnd)).subscribe(event=>{
      if(this.routeReady)void this.applyRoute(event.urlAfterRedirects);
    });
    if (!this.supabase.configured) {this.routeReady=true;await this.applyRoute(this.router.url);return;}
    try {
      const currentUser = await this.supabase.currentUser();
      if (currentUser) await this.loadAccount(currentUser.id, currentUser.email ?? '',false);
    } catch { /* Une indisponibilité Supabase ne doit pas casser l'accueil public. */ }
    this.routeReady=true;
    await this.applyRoute(this.router.url);
  }

  ngOnDestroy(){this.navigationSubscription?.unsubscribe();if(this.communityPollTimer)clearInterval(this.communityPollTimer);if(this.videoObjectUrl)URL.revokeObjectURL(this.videoObjectUrl)}

  go(screen: Screen,replaceUrl=false) {
    if(this.screen==='journal'&&screen!=='journal'&&(this.autosaveState==='pending'||this.autosaveState==='saving'))void this.saveJournal(true);
    const context=this.navigationContext();
    const destination=this.navigation.routeFor(screen,context);
    const requiresAccount=this.navigation.privateScreens.has(screen)||(screen==='reader'&&context.readerOrigin!=='public');
    if(!this.userId&&requiresAccount){
      this.authMode='login';this.screen='auth';
      if(!this.applyingRoute)void this.router.navigateByUrl(this.navigation.loginRoute(destination),{replaceUrl:true});
    }else{
      this.screen=screen;
      if(!this.applyingRoute&&this.router.url!==destination)void this.router.navigateByUrl(destination,{replaceUrl});
    }
    this.menuOpen=false;window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private navigationContext():NavigationContext {
    return {
      tripId:this.selectedTrip?.id,
      dayId:this.selectedDay?.id,
      publicationSlug:this.selectedPublicSlug,
      username:this.publicProfileUsername,
      conversationId:this.activeConversationId,
      videoProjectId:this.screen==='video-studio'?this.videoProject?.id:undefined,
      destinationId:this.activeDestinationId,
      placeId:this.activePlaceId,
      readerPage:this.readerIndex+1,
      readerOrigin:this.readerOrigin==='public-trip'?'public':'owner'
    };
  }

  private async applyRoute(url:string) {
    const route=this.navigation.parse(url);
    if(route.screen==='auth'){
      if(this.userId){
        const target=this.travelerCompleted?(route.returnUrl||this.consumeOAuthReturnUrl()||'/home'):'/onboarding';
        await this.router.navigateByUrl(target,{replaceUrl:true});return
      }
      const oauthError=this.oauthErrorFromUrl(url);
      if(oauthError){
        sessionStorage.removeItem(this.oauthReturnUrlKey);
        this.notify(`Connexion Google interrompue : ${oauthError}`);
        if(url!=='/login'){await this.router.navigateByUrl('/login',{replaceUrl:true});return}
      }
      this.authMode='login';this.screen='auth';return;
    }
    const ownerReader=route.screen==='reader'&&route.readerOrigin==='owner';
    if(!this.userId&&(this.navigation.privateScreens.has(route.screen)||ownerReader)){
      this.authMode='login';this.screen='auth';
      await this.router.navigateByUrl(this.navigation.loginRoute(url),{replaceUrl:true});return;
    }
    if(route.screen==='splash'&&this.userId){await this.router.navigateByUrl(this.travelerCompleted?'/home':'/onboarding',{replaceUrl:true});return}

    this.applyingRoute=true;
    try{
      switch(route.screen){
        case 'dashboard': await this.restoreTripRoute(route);break;
        case 'journal': await this.restoreJournalRoute(route);break;
        case 'explore': if(this.exploreLoading){this.screen='explore'}else await this.openExplore();break;
        case 'destination': this.activeDestinationId=route.destinationId??'';this.destination=await this.supabase.destinationDetails(this.activeDestinationId);this.screen='destination';break;
        case 'place': this.activePlaceId=route.placeId??'';this.selectedPlace=await this.supabase.placeDetails(this.activePlaceId);this.screen='place';break;
        case 'public-trip': await this.restorePublicTripRoute(route);break;
        case 'public-profile': await this.restoreProfileRoute(route);break;
        case 'inspirations': await this.openInspirations();break;
        case 'inbox': if(this.inboxLoading){this.screen='inbox'}else await this.openInbox();break;
        case 'conversation': if(this.activeConversationId===route.conversationId&&this.conversationLoading)this.screen='conversation';else await this.openConversation(route.conversationId??'');break;
        case 'video-studio': await this.restoreVideoRoute(route);break;
        case 'reader': await this.restoreReaderRoute(route);break;
        default:this.screen=route.screen;
      }
    }catch(error){
      this.notify(this.errorMessage(error));
      const fallback=this.userId?'/home':'/';
      if(this.router.url!==fallback)await this.router.navigateByUrl(fallback,{replaceUrl:true});
    }finally{this.applyingRoute=false}
  }

  private tripFromRoute(tripId?:string){return this.trips.find(trip=>trip.id===tripId)??null}

  private async restoreTripRoute(route:AppRouteState){
    const trip=this.tripFromRoute(route.tripId);
    if(!trip){await this.router.navigateByUrl('/trips',{replaceUrl:true});return}
    const changed=this.selectedTrip?.id!==trip.id;this.selectedTrip=trip;this.selectedDay=null;this.tripTab='journal';this.screen='dashboard';
    if(changed||!this.tripStats)await this.loadTripInsights();
  }

  private async restoreJournalRoute(route:AppRouteState){
    const trip=this.tripFromRoute(route.tripId);const day=trip?.days.find(item=>item.id===route.dayId);
    if(!trip||!day){await this.router.navigateByUrl(route.tripId?`/trips/${encodeURIComponent(route.tripId)}`:'/trips',{replaceUrl:true});return}
    this.selectedTrip=trip;
    if(this.selectedDay?.id===day.id&&this.screen==='journal')return;
    await this.openJournal(day);
  }

  private async restorePublicTripRoute(route:AppRouteState){
    const slug=route.publicationSlug??'';
    if(this.selectedPublicSlug===slug&&this.selectedPublicTrip){this.screen='public-trip';return}
    const publication=await this.supabase.publicTrip(slug);
    if(!publication){await this.router.navigateByUrl('/explore',{replaceUrl:true});return}
    await this.openPublicTrip(publication);
  }

  private async restoreProfileRoute(route:AppRouteState){
    const username=route.username??'';
    if(this.publicProfileUsername===username&&this.communityProfile){this.screen='public-profile';return}
    const userId=await this.supabase.profileIdByUsername(username);
    if(!userId){await this.router.navigateByUrl('/explore',{replaceUrl:true});return}
    await this.openCommunityProfile(userId);
  }

  private async restoreVideoRoute(route:AppRouteState){
    if(route.videoProjectId){
      if(this.screen==='video-studio'&&this.videoProject?.id===route.videoProjectId)return;
      const project=await this.supabase.videoProject(route.videoProjectId);
      const trip=this.tripFromRoute(project?.trip_id);
      if(!project||!trip){await this.router.navigateByUrl('/trips',{replaceUrl:true});return}
      this.selectedTrip=trip;this.videoProject=project;this.videoDay=trip.days.find(day=>day.id===project.trip_day_id)??null;
      this.videoMedia=this.videoDay?.id?await this.supabase.media(this.videoDay.id):await this.supabase.tripMedia(trip.id);
      this.videoExport=project.export_url?{status:'completed',progress:100,label:'Dernier film enregistré',url:project.export_url,fileName:`${project.title||'film-souvenir'}.mp4`}:null;
      this.screen='video-studio';return;
    }
    const trip=this.tripFromRoute(route.tripId);if(!trip){await this.router.navigateByUrl('/trips',{replaceUrl:true});return}
    this.selectedTrip=trip;const day=trip.days.find(item=>item.id===route.dayId)??null;
    if(this.screen==='video-studio'&&this.videoBusy)return;
    await this.openVideoStudio(day);
  }

  private async restoreReaderRoute(route:AppRouteState){
    const targetIndex=Math.max(0,(route.readerPage??1)-1);
    if(route.readerOrigin==='public'){
      if(this.screen==='reader'&&this.readerOrigin==='public-trip'&&this.selectedPublicSlug===route.publicationSlug){this.goToReaderPage(targetIndex,false);return}
      await this.restorePublicTripRoute({...route,screen:'public-trip'});this.openPublicReader();
    }else{
      const trip=this.tripFromRoute(route.tripId);if(!trip){await this.router.navigateByUrl('/trips',{replaceUrl:true});return}
      if(this.screen==='reader'&&this.readerOrigin==='dashboard'&&this.selectedTrip?.id===trip.id){this.goToReaderPage(targetIndex,false);return}
      this.selectedTrip=trip;await this.loadTripInsights();await this.openOwnerReader();
    }
    this.goToReaderPage(targetIndex,false);
  }
  start() { this.go('auth'); }
  async signInWithGoogle() {
    if(this.googleAuthLoading)return;
    if(!this.supabase.configured){this.notify('Ajoute d\u2019abord tes cl\u00e9s Supabase dans environment.ts');return}
    const route=this.navigation.parse(this.router.url);
    const returnUrl=this.safeReturnUrl(route.screen==='auth'?route.returnUrl:null)||'/home';
    sessionStorage.setItem(this.oauthReturnUrlKey,returnUrl);
    this.googleAuthLoading=true;
    try{
      await this.supabase.signInWithGoogle(`${window.location.origin}/login`);
    }catch(error){
      sessionStorage.removeItem(this.oauthReturnUrlKey);
      this.googleAuthLoading=false;
      this.notify(this.errorMessage(error));
    }
  }
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
        this.userId=result.session.user.id;this.travelerCompleted=false;
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
      this.travelerCompleted=true;
      this.notify('Ton cocon voyageur est prêt !');
      const target=this.consumeOAuthReturnUrl()||'/home';
      await this.router.navigateByUrl(target,{replaceUrl:true});
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  async createTrip() {
    if (!this.tripForm.title || !this.tripForm.country || !this.tripForm.startDate || !this.tripForm.endDate) { this.notify('Complète les informations essentielles'); return; }
    if (new Date(this.tripForm.endDate) < new Date(this.tripForm.startDate)) { this.notify('La date de retour doit suivre le départ'); return; }
    if(this.creatingTrip)return;this.creatingTrip=true;this.clearActionError('create-trip');try {
      const currentUser = await this.requireUser();
      const data = await this.supabase.createTrip({ owner_id: currentUser.id, title: this.tripForm.title, country: this.tripForm.country, start_date: this.tripForm.startDate, end_date: this.tripForm.endDate, currency: this.tripForm.currency, planned_budget: this.tripForm.budget, visibility: this.tripForm.visibility });
      const trip = this.mapTrip(data); this.trips.unshift(trip); this.openTrip(trip); this.notify('Voyage créé, l’aventure commence !');
    } catch (error) { this.setActionError('create-trip',this.errorMessage(error),()=>this.createTrip()); }finally{this.creatingTrip=false}
  }
  openTrip(trip: Trip) { this.selectedTrip = trip; this.tripTab='journal';this.go('dashboard'); this.loadTripInsights(); }
  setTripTab(tab:TripTab){this.tripTab=tab;if(tab==='map')setTimeout(()=>this.renderMap(),0)}
  setJournalStep(step:JournalStep){if(step===4&&!this.journal.title&&!this.journal.events.length){this.notify('Génère d’abord ta journée.');return}this.journalStep=step;if(this.selectedDay?.id){localStorage.setItem(`journal-step-${this.selectedDay.id}`,String(step));void this.supabase.saveJournalStep(this.selectedDay.id,step).catch(()=>{})}window.scrollTo({top:0,behavior:'smooth'})}
  private defaultScrapbookDesign():ScrapbookDesign{return{style:'wanderlust',palette:'candy',paper:'grid',composition:'collage',font:'handwritten',decorations:'balanced',customAccent:'',customPaper:''}}
  get scrapbookDesignClasses(){const d=this.journal.design;return[`scrap-style-${d.style}`,`scrap-palette-${d.palette}`,`scrap-paper-${d.paper}`,`scrap-composition-${d.composition}`,`scrap-font-${d.font}`,`scrap-decor-${d.decorations}`]}
  get scrapbookDesignStyles(){return{'--scrap-accent':this.journal.design.customAccent||null,'--scrap-bg':this.journal.design.customPaper||null}}
  setScrapbookOption<K extends keyof ScrapbookDesign>(key:K,value:ScrapbookDesign[K]){this.journal.design={...this.journal.design,[key]:value};this.scheduleAutosave()}
  randomizeScrapbook(){const choices={style:['wanderlust','retro','botanical','nocturne'],palette:['candy','sunset','ocean','forest','mono','lavender'],paper:['grid','kraft','floral','clean'],composition:['collage','polaroid','postcard','filmstrip'],font:['handwritten','editorial','typewriter'],decorations:['minimal','balanced','maximal']} as const;const pick=(values:readonly string[])=>values[Math.floor(Math.random()*values.length)];this.journal.design={style:pick(choices.style),palette:pick(choices.palette),paper:pick(choices.paper),composition:pick(choices.composition),font:pick(choices.font),decorations:pick(choices.decorations),customAccent:'',customPaper:''} as ScrapbookDesign;this.scheduleAutosave();this.notify('Une nouvelle combinaison a été créée ✦')}
  async loadTripInsights() { if (!this.selectedTrip) return; try { [this.expenses,this.placeVisits,this.tripStats,this.tripCommandCenter] = await Promise.all([this.supabase.expenses(this.selectedTrip.id),this.supabase.placeVisits(this.selectedTrip.id),this.supabase.tripStatistics(this.selectedTrip.id),this.supabase.tripCommandCenter(this.selectedTrip.id)]);this.buildDayProgress(); setTimeout(()=>this.renderMap(),0); } catch (error) { this.notify(this.errorMessage(error)); } }
  private buildDayProgress(){this.dayProgress=buildTripDayProgress(this.tripCommandCenter?.days??[])}
  get nextDayProgress(){return this.dayProgress.find(day=>day.state!=='complete')??this.dayProgress.at(-1)??null}
  get toldDaysCount(){return this.dayProgress.filter(day=>day.state==='complete'||day.state==='review'||(day.state==='draft'&&!!day.title)).length}
  get unusedPhotosCount(){return this.dayProgress.reduce((total,day)=>total+day.unusedPhotos,0)}
  get pendingPlacesCount(){return this.dayProgress.reduce((total,day)=>total+day.pendingPlaces,0)}
  get missingExpensesCount(){const today=new Date().toISOString().slice(0,10);return this.dayProgress.filter(day=>day.date<=today&&day.expenseCount===0).length}
  progressForDay(day:TripDay){return this.dayProgress.find(item=>item.dayId===day.id)}
  continueNextDay(){const progress=this.nextDayProgress;if(!progress||!this.selectedTrip)return;const day=this.selectedTrip.days.find(item=>item.id===progress.dayId);if(day)void this.openJournal(day,progress.step)}
  private renderMap() { const element=document.getElementById('trip-map'); if (!element) return; this.map?.remove(); const points=this.placeVisits.filter(v=>v.places?.latitude!=null&&v.places?.longitude!=null); this.map=L.map(element).setView(points.length?[points[0].places.latitude,points[0].places.longitude]:[16.05,108.2],points.length?7:5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(this.map); const bounds:L.LatLngExpression[]=[]; points.forEach(visit=>{const point:[number,number]=[visit.places.latitude,visit.places.longitude];bounds.push(point);const marker=L.circleMarker(point,{radius:9,color:'#76529a',fillColor:'#c8b6ff',fillOpacity:.9}).addTo(this.map!).bindTooltip(`${visit.places.name} · ${visit.places.city??''}`);marker.on('click',()=>{const day=this.selectedTrip?.days.find(item=>item.id===visit.trip_day_id);if(day)this.openJournal(day)});});if(bounds.length>1)this.map.fitBounds(L.latLngBounds(bounds),{padding:[30,30]}); }
  async openJournal(day: TripDay,preferredStep?:JournalStep) {
    if (!day.id) { this.notify('Cette journée doit être synchronisée avec Supabase.'); return; }
    this.selectedDay = day;this.cancelExpenseEdit();this.journalEditing=false;this.journalStep=preferredStep??1; this.journal = { title: '', summary: '', rawText: '', layout: 'scrapbook', coverMediaId: '', status: 'draft', design:this.defaultScrapbookDesign(), events: [], places: [] }; this.journalMedia = []; this.go('journal');
    try {
      const [saved, media] = await Promise.all([this.supabase.journal(day.id), this.supabase.media(day.id)]);
      this.journalMedia = media;
      if (saved) this.journal = { title: saved.title ?? '', summary: saved.summary ?? '', rawText: saved.raw_text ?? '', layout: 'scrapbook', coverMediaId: saved.cover_media_id ?? '', status: saved.status ?? 'draft', design:{...this.defaultScrapbookDesign(),...(saved.design_settings??{})}, events: (saved.journal_events ?? []).sort((a: any,b: any) => a.event_order-b.event_order).map((event:any)=>({...event,time:event.event_time??event.time,place:event.place_text??event.place,type:event.event_type??event.type})), places: saved.place_candidates ?? [] };
      if (!this.journal.coverMediaId) this.journal.coverMediaId = this.photoMedia[0]?.id ?? '';
      const localStep=Number(localStorage.getItem(`journal-step-${day.id}`)??0);const restored=preferredStep??(localStep>=1&&localStep<=4?localStep:Number(saved?.last_step??this.inferJournalStep()));this.journalStep=Math.min(4,Math.max(1,restored)) as JournalStep;
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  async addMedia(event: Event) {
    const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []);
    if (!this.selectedTrip || !this.selectedDay?.id || !files.length) return;
    try { this.uploadingMedia=true;this.clearActionError('media');const user = await this.requireUser();let completed=0;for (const file of files){this.uploadProgress=`Import de ${completed+1}/${files.length} · ${file.name}`;this.journalMedia.push(await this.supabase.uploadMedia(user.id, this.selectedTrip.id, this.selectedDay.id, file));completed++} if (!this.journal.coverMediaId && this.photoMedia[0]) await this.selectCover(this.photoMedia[0]); else this.scheduleAutosave();this.uploadProgress=`${files.length} média${files.length>1?'s':''} ajouté${files.length>1?'s':''}`; this.notify(this.uploadProgress); }
    catch (error) { this.setActionError('media',this.errorMessage(error),async()=>{this.notify('Sélectionne à nouveau les fichiers à importer.')}); } finally { this.uploadingMedia=false;input.value = ''; }
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
    try {
      this.generating = true;
      this.clearActionError('ai');
      this.aiProgress = 18;
      this.aiStage = 'Transcription terminée';
      const stages = [
        { at: 35, label: 'Événements identifiés' },
        { at: 58, label: 'Lieux détectés' },
        { at: 78, label: 'Carnet en création' },
      ];
      this.aiProgressTimer = setInterval(() => {
        this.aiProgress = Math.min(this.aiProgress + 4, 88);
        const stage = [...stages].reverse().find(item => this.aiProgress >= item.at);
        if (stage) this.aiStage = stage.label;
      }, 500);
      const selectedMedia = this.journalMedia
        .filter(media => media.selected !== false)
        .map(media => ({ id: media.id, type: media.media_type, name: media.original_name }));
      const result = await this.supabase.generateJournal(
        this.selectedDay.id,
        this.journal.rawText,
        selectedMedia,
      );
      this.journal.title = result.title;
      this.journal.summary = result.summary;
      this.journal.events = result.events ?? [];
      this.journal.places = result.placeCandidates ?? [];
      this.journal.layout = 'scrapbook';
      this.journalEditing = false;
      this.journalStep = 3;
      localStorage.setItem(`journal-step-${this.selectedDay.id}`, '3');
      this.aiProgress = 100;
      this.aiStage = 'Carnet prêt';
      await this.saveJournal(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.notify('Ta journée est prête · vérifie maintenant les éléments incertains ✨');
    }
    catch (error) { this.setActionError('ai',this.errorMessage(error),()=>this.generateJournal()); } finally { if(this.aiProgressTimer)clearInterval(this.aiProgressTimer);this.aiProgressTimer=undefined;this.generating = false; }
  }
  scheduleAutosave() { this.autosaveState='pending';clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => this.saveJournal(true), 900); }
  async saveJournal(silent = false) {
    if (!this.selectedDay?.id) return;
    try { this.autosaveState='saving';await this.supabase.saveJournal(this.selectedDay.id, { title: this.journal.title, summary: this.journal.summary, raw_text: this.journal.rawText, layout: this.journal.layout, cover_media_id: this.journal.coverMediaId || null, status: this.journal.status,design_settings:this.journal.design,last_step:this.journalStep }, this.journal.events); this.selectedDay.note = this.journal.summary || this.journal.title;this.autosaveState='saved'; if (!silent) this.notify('Brouillon enregistré'); }
    catch (error) { this.autosaveState='error';this.setActionError('autosave',this.errorMessage(error),()=>this.saveJournal(silent));if (!silent) this.notify(this.errorMessage(error)); }
  }
  async completeJournalDay(){if(this.pendingJournalPlaces.length||this.uncertainEvents.length){this.journalStep=3;this.notify('Vérifie d’abord les éléments incertains.');return}this.journal.status='published';this.journalStep=4;await this.saveJournal(false);if(this.autosaveState==='error')return;await this.loadTripInsights();this.go('dashboard');this.notify('Journée terminée · ton carnet avance ✦')}
  async confirmPlace(place: any, decision: boolean) {
    if (!place.id) return;
    if (!decision) { place.status='rejected'; try { await this.supabase.updatePlaceCandidate(place.id,'rejected'); } catch(error){place.status='pending';this.notify(this.errorMessage(error))} return; }
    try { place.resolving=true; place.matches=await this.supabase.resolvePlace(place,this.selectedTrip?.country??''); if(!place.matches.length)this.notify('Aucun lieu correspondant trouvé. Essaie de préciser son nom ou sa ville.'); }
    catch(error){this.notify(this.errorMessage(error))} finally {place.resolving=false}
  }
  async choosePlace(place:any,match:any){if(!this.selectedDay?.id)return;try{place.resolving=true;const result=await this.supabase.confirmPlaceCandidate(place,match,this.selectedDay.id);place.status='confirmed';place.visitId=result.visit.id;place.latitude=match.latitude;place.longitude=match.longitude;place.city=match.city;place.matches=[];this.notify('Lieu confirmé · il apparaîtra sur la carte ✦')}catch(error){this.notify(this.errorMessage(error))}finally{place.resolving=false}}
  async ratePlace(place: any, field: 'liked' | 'recommended', value: boolean) { place[field] = value; try { if (place.visitId) await this.supabase.ratePlaceVisit(place.visitId, { [field]: value }); } catch (error) { this.notify(this.errorMessage(error)); } }
  private inferJournalStep():JournalStep{if(!this.journalMedia.length)return 1;if(!this.journal.rawText.trim())return 2;if(!this.journal.title&&!this.journal.events.length)return 2;if(this.pendingJournalPlaces.length||this.uncertainEvents.length)return 3;return 4}
  get photoMedia() { return this.journalMedia.filter(media => media.media_type === 'photo' && media.url&&media.selected!==false); }
  get allPhotoMedia(){return this.journalMedia.filter(media=>media.media_type==='photo'&&media.url)}
  get coverPhoto() { return this.photoMedia.find(media => media.id === this.journal.coverMediaId) ?? this.photoMedia[0] ?? null; }
  get galleryPhotos() { return this.photoMedia.filter(media => media.id !== this.coverPhoto?.id).slice(0, 3); }
  async selectCover(media: any) { this.journal.coverMediaId = media.id; if(this.selectedTrip){this.selectedTrip.coverUrl=media.url;try{await this.supabase.setTripCover(this.selectedTrip.id,media.storage_path)}catch(error){this.notify(this.errorMessage(error))}} this.scheduleAutosave(); }
  private draggedMedia:any=null;
  startMediaDrag(media:any){this.draggedMedia=media}
  async dropMedia(target:any){if(!this.draggedMedia||this.draggedMedia.id===target.id)return;const from=this.journalMedia.findIndex(item=>item.id===this.draggedMedia.id);const to=this.journalMedia.findIndex(item=>item.id===target.id);const reordered=[...this.journalMedia];const[moved]=reordered.splice(from,1);reordered.splice(to,0,moved);this.journalMedia=reordered;this.draggedMedia=null;try{await this.supabase.reorderMedia(reordered);this.scheduleAutosave()}catch(error){this.notify(this.errorMessage(error))}}
  async moveMedia(media:any,direction:-1|1){const index=this.journalMedia.findIndex(item=>item.id===media.id);const target=index+direction;if(index<0||target<0||target>=this.journalMedia.length)return;const reordered=[...this.journalMedia];[reordered[index],reordered[target]]=[reordered[target],reordered[index]];this.journalMedia=reordered;try{await this.supabase.reorderMedia(reordered);this.scheduleAutosave()}catch(error){this.notify(this.errorMessage(error))}}
  async toggleMediaSelection(media:any){const selected=media.selected===false;media.selected=selected;if(!selected&&this.journal.coverMediaId===media.id)this.journal.coverMediaId=this.photoMedia[0]?.id??'';try{await this.supabase.setMediaSelected(media.id,selected);this.scheduleAutosave()}catch(error){media.selected=!selected;this.notify(this.errorMessage(error))}}
  scheduleMediaCaption(media:any){clearTimeout(this.mediaCaptionTimer);this.autosaveState='pending';this.mediaCaptionTimer=setTimeout(async()=>{try{this.autosaveState='saving';await this.supabase.setMediaCaption(media.id,String(media.caption??'').trim());this.autosaveState='saved'}catch(error){this.autosaveState='error';this.notify(this.errorMessage(error))}},650)}
  get pendingJournalPlaces(){return this.journal.places.filter((place:any)=>!place.status||place.status==='pending')}
  get uncertainEvents(){return this.journal.events.filter((event:any)=>event.review_status==='pending'||Number(event.confidence??1)<.78)}
  confirmEvent(event:any){event.review_status='confirmed';this.scheduleAutosave()}

  @HostListener('document:visibilitychange') persistHiddenJournal(){if(document.visibilityState==='hidden'&&this.screen==='journal'&&this.autosaveState==='pending')void this.saveJournal(true)}
  async addExpense(){if(!this.selectedTrip||!this.selectedDay?.id||!this.expense.label.trim()||!this.expense.amount||this.expense.amount<=0||this.expenseSaving)return;const converted=this.expense.currency===this.selectedTrip.currency?this.expense.amount:this.expense.convertedAmount;if(converted==null||converted<=0){this.notify(`Indique l’équivalent en ${this.selectedTrip.currency}`);return}this.expenseSaving=true;try{const payload={label:this.expense.label.trim(),amount:this.expense.amount,currency:this.expense.currency,convertedAmount:converted,convertedCurrency:this.selectedTrip.currency,category:this.expense.category,date:this.selectedDay.date};const saved=this.editingExpenseId?await this.supabase.updateExpense(this.editingExpenseId,this.selectedTrip.id,this.selectedDay.id,payload):await this.supabase.saveExpense(this.selectedTrip.id,this.selectedDay.id,payload);const index=this.expenses.findIndex(item=>item.id===saved.id);if(index>=0)this.expenses[index]=saved;else this.expenses.push(saved);this.expenses=[...this.expenses].sort((a,b)=>String(a.expense_date).localeCompare(String(b.expense_date)));const edited=!!this.editingExpenseId;this.cancelExpenseEdit();this.notify(edited?'Dépense modifiée':'Dépense ajoutée')}catch(error){this.notify(this.errorMessage(error))}finally{this.expenseSaving=false}}
  async editExpense(item:any){const day=this.selectedTrip?.days.find(candidate=>candidate.id===item.trip_day_id);if(!day){this.notify('La journée liée à cette dépense est introuvable.');return}await this.openJournal(day);this.editingExpenseId=item.id;this.expense={label:item.label??item.description??'',amount:Number(item.amount),convertedAmount:item.converted_amount==null?null:Number(item.converted_amount),currency:item.currency,category:item.category||'Autre'};setTimeout(()=>document.querySelector('.expense-panel')?.scrollIntoView({behavior:'smooth',block:'center'}),0)}
  cancelExpenseEdit(){this.editingExpenseId='';this.expense={label:'',amount:null,convertedAmount:null,currency:this.selectedTrip?.currency??'EUR',category:'Restauration'}}
  get spentTotal(){return this.expenses.reduce((sum,e)=>sum+Number(e.converted_amount??e.amount),0)}
  get remainingBudget(){return (this.selectedTrip?.budget??0)-this.spentTotal}
  get dailyAverage(){return this.selectedTrip?.days.length?this.spentTotal/this.selectedTrip.days.length:0}
  categoryTotal(category:string){return this.expenses.filter(e=>e.category===category).reduce((sum,e)=>sum+Number(e.converted_amount??e.amount),0)}
  async completeTrip(){if(!this.selectedTrip||this.completingTrip)return;this.completingTrip=true;this.clearActionError('complete-trip');try{this.tripStats=await this.supabase.finishTrip(this.selectedTrip.id);this.notify('Voyage terminé · ta page en chiffres est prête !')}catch(error){this.setActionError('complete-trip',this.errorMessage(error),()=>this.completeTrip())}finally{this.completingTrip=false}}
  async publishTrip(){if(!this.selectedTrip||this.publishingTrip)return;this.publishingTrip=true;this.publishedSlug='';this.clearActionError('publication');this.publishProgress=8;this.publishStage='Préparation du carnet';const stages=[{at:24,label:'Assemblage des journées'},{at:43,label:'Sélection des contenus publics'},{at:62,label:'Copie sécurisée des photos'},{at:82,label:'Création de la page publique'}];this.publishProgressTimer=setInterval(()=>{this.publishProgress=Math.min(this.publishProgress+3,92);const stage=[...stages].reverse().find(item=>this.publishProgress>=item.at);if(stage)this.publishStage=stage.label},450);try{const slug=await this.supabase.publishTrip(this.selectedTrip.id,this.publication);this.publishProgress=100;this.publishStage='Voyage publié';this.publishedSlug=slug;await this.loadTripInsights();this.notify('Ton voyage est maintenant public ✦')}catch(error){this.publishProgress=0;this.publishStage='';this.setActionError('publication',this.errorMessage(error),()=>this.publishTrip())}finally{if(this.publishProgressTimer)clearInterval(this.publishProgressTimer);this.publishProgressTimer=undefined;this.publishingTrip=false}}
  async submitTripFeedback(){if(!this.selectedTrip)return;try{await this.supabase.saveTripFeedback(this.selectedTrip.id,this.tripFeedback);this.notify('Merci, ton expérience aidera les prochains voyageurs.')}catch(error){this.notify(this.errorMessage(error))}}
  async openExplore(){this.go('explore');this.exploreLoading=true;this.clearActionError('explore');try{this.publicTrips=await this.supabase.explorePublicTrips();await this.runTravelSearch(false);await Promise.all(this.publicTrips.map(async item=>{const id=item.snapshot?.trip?.id;if(id)Object.assign(item.snapshot,await this.supabase.tripEngagement(id))}))}catch(error){this.setActionError('explore',this.errorMessage(error),()=>this.openExplore())}finally{this.exploreLoading=false}}
  async runTravelSearch(mark=true){if(mark)this.searchPerformed=true;try{this.searchResults=await this.supabase.searchTravelBase({query:this.exploreSearch,...this.searchFilters})}catch(error){if(mark)this.setActionError('explore',this.errorMessage(error),()=>this.runTravelSearch())}}
  clearTravelFilters(){this.exploreSearch='';this.searchFilters={month:0,minDuration:null,maxDuration:null,maxBudget:null,tripType:'',category:'',recommendedOnly:false,recentOnly:false};void this.runTravelSearch()}
  async openDestination(item:any){this.activeDestinationId=item.id;this.exploreLoading=true;try{this.destination=await this.supabase.destinationDetails(item.id);this.go('destination')}catch(error){this.notify(this.errorMessage(error))}finally{this.exploreLoading=false}}
  async openPlace(item:any){this.activePlaceId=item.id;this.exploreLoading=true;try{this.selectedPlace=await this.supabase.placeDetails(item.id);this.go('place')}catch(error){this.notify(this.errorMessage(error))}finally{this.exploreLoading=false}}
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
  async openPublicTrip(item:any){if(!item?.snapshot){this.notify('Ce carnet n’est plus disponible.');return}this.selectedPublicSlug=item.slug??this.selectedPublicSlug;this.selectedPublicTrip=item.snapshot;this.go('public-trip');await this.loadPublicInteractions()}
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
  async openCommunityProfile(userId:string){try{this.communityProfile=await this.supabase.communityProfile(userId);this.publicProfileUsername=this.communityProfile?.profile?.username??'';this.relationship=await this.supabase.relationship(userId);this.go('public-profile')}catch(error){this.notify(this.errorMessage(error))}}
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
  async openVideoStudio(day:TripDay|null=null){
    if(!this.selectedTrip)return;
    this.videoOrigin=this.screen;this.videoDay=day;this.videoProject=null;this.videoExport=null;this.videoError='';this.videoBusy='loading';this.go('video-studio');
    try{
      [this.videoMedia,this.videoProject]=await Promise.all([day?.id?this.supabase.media(day.id):this.supabase.tripMedia(this.selectedTrip.id),this.supabase.latestVideoProject(this.selectedTrip.id,day?.id)]);
      if(this.videoProject?.export_url)this.videoExport={status:'completed',progress:100,label:'Dernier film enregistré',url:this.videoProject.export_url,fileName:`${this.videoProject.title || 'film-souvenir'}.mp4`}
      if(this.videoProject?.id&&!this.applyingRoute)await this.router.navigateByUrl(`/video/${encodeURIComponent(this.videoProject.id)}`,{replaceUrl:true});
    }catch(error){this.videoError=this.errorMessage(error)}finally{this.videoBusy=''}
  }
  closeVideoStudio(){if(this.videoOrigin==='journal'&&this.videoDay)this.go('journal');else{this.go('dashboard');void this.loadTripInsights()}}
  async generateVideoStoryboard(config:VideoStudioConfig){
    if(!this.selectedTrip||this.videoBusy)return;this.videoBusy='generating';this.videoError='';
    try{const result=await this.supabase.generateVideoStoryboard({tripId:this.selectedTrip.id,tripDayId:this.videoDay?.id??null,format:config.format,targetDuration:config.targetDuration,style:{palette:config.palette,music:config.music,showText:config.showText,style:'scrapbook'}});this.videoProject=result.project;if(this.videoProject?.id)await this.router.navigateByUrl(`/video/${encodeURIComponent(this.videoProject.id)}`,{replaceUrl:true});this.notify('Storyboard prêt · personnalise maintenant ton film ✦')}
    catch(error){this.videoError=this.errorMessage(error)}finally{this.videoBusy=''}
  }
  async saveVideoProject(project:any,announce=true){
    if(!project||this.videoBusy)return;this.videoBusy='saving';this.videoError='';
    try{await this.supabase.saveVideoStoryboard(project);this.videoProject=await this.supabase.latestVideoProject(project.trip_id,project.trip_day_id);if(announce)this.notify('Film enregistré')}
    catch(error){this.videoError=this.errorMessage(error);throw error}finally{this.videoBusy=''}
  }
  async exportVideoInBrowser(project:any){
    if(!project||this.videoBusy)return;this.videoError='';
    try{
      await this.saveVideoProject(project,false);this.videoBusy='rendering';
      const result=await this.browserVideo.render(this.videoProject,this.videoMedia,(progress:BrowserVideoProgress)=>this.videoExport={...progress});
      if(this.videoObjectUrl)URL.revokeObjectURL(this.videoObjectUrl);this.videoObjectUrl=URL.createObjectURL(result.blob);
      this.videoExport={status:'uploading',progress:98,label:'Sauvegarde dans tes souvenirs',url:this.videoObjectUrl,fileName:result.fileName};
      this.downloadBrowserVideo(this.videoObjectUrl,result.fileName);
      try{const saved=await this.supabase.uploadBrowserVideo(this.videoProject.id,result.blob,result.fileName);this.videoProject={...this.videoProject,latest_export_path:saved.storagePath,export_url:saved.url};this.videoExport={status:'completed',progress:100,label:'Film prêt et sauvegardé',url:saved.url||this.videoObjectUrl,fileName:result.fileName}}
      catch(uploadError){this.videoExport={status:'completed',progress:100,label:'Film téléchargé sur cet appareil',url:this.videoObjectUrl,fileName:result.fileName,warning:`La copie cloud n’a pas pu être enregistrée : ${this.errorMessage(uploadError)}`}}
      this.notify('Ton film souvenir est prêt ✦');
    }catch(error){this.videoError=this.errorMessage(error);this.videoExport={status:'failed',progress:0,label:'Export interrompu',error_message:this.videoError}}finally{this.videoBusy=''}
  }
  private downloadBrowserVideo(url:string,fileName:string){const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove()}
  async openOwnerReader() { if (!this.selectedTrip||this.openingReader) return;this.openingReader=true; try { const days=await this.supabase.tripReader(this.selectedTrip.id); this.readerTrip={ id:this.selectedTrip.id,title:this.selectedTrip.title,country:this.selectedTrip.country,startDate:this.selectedTrip.startDate,endDate:this.selectedTrip.endDate,author:this.user.firstname,design:'scrapbook',stats:this.tripStats,places:this.placeVisits }; this.readerPages=buildSignatureReaderPages(days.map((day:any)=>{const journal=day.day_journals?.[0]??day.day_journals??{};return{date:day.day_date,title:journal.title||day.label||`Jour ${day.day_number}`,summary:journal.summary||day.notes||'',layout:'scrapbook',design:{...this.defaultScrapbookDesign(),...(journal.design_settings??{})},events:(journal.journal_events??[]).sort((a:any,b:any)=>a.event_order-b.event_order).map((event:any)=>({time:event.event_time,title:event.title,description:event.description,place:event.place_text})),photos:(day.trip_media??[]).map((media:any)=>({url:media.url,caption:media.caption??''})).filter((photo:any)=>photo.url)}}),this.readerTrip,this.defaultScrapbookDesign()); this.readerOrigin='dashboard';this.restoreReaderPosition();this.go('reader'); } catch(error){this.notify(this.errorMessage(error))}finally{this.openingReader=false} }
  openPublicReader(){if(!this.selectedPublicTrip)return;const sourceDays=this.selectedPublicTrip.days??[];const allPhotos=(this.selectedPublicTrip.photos??[]).filter(Boolean);const legacyBuckets=sourceDays.map((_:any,index:number)=>allPhotos.filter((_:string,photoIndex:number)=>photoIndex%Math.max(sourceDays.length,1)===index));const days=sourceDays.map((day:any,index:number)=>({...day,layout:'scrapbook',photos:(this.selectedPublicTrip.photoDetails?.[day.date]??this.selectedPublicTrip.photoDays?.[day.date]??legacyBuckets[index]??[]).filter(Boolean),events:day.events??[]}));this.readerTrip={...this.selectedPublicTrip.trip,author:this.selectedPublicTrip.author.firstname||this.selectedPublicTrip.author.username,design:'scrapbook',stats:this.selectedPublicTrip.stats,places:this.selectedPublicTrip.places??[]};this.readerPages=buildSignatureReaderPages(days,this.readerTrip,this.defaultScrapbookDesign());this.readerOrigin='public-trip';this.restoreReaderPosition();this.go('reader')}
  get readerPage(){return this.readerPages[this.readerIndex]??null}
  get readerDesignClasses(){const d={...this.defaultScrapbookDesign(),...(this.readerPage?.design??{})};return[`composition-${this.readerPage?.composition||'classic'}`,`scrap-style-${d.style}`,`scrap-palette-${d.palette}`,`scrap-paper-${d.paper}`,`scrap-font-${d.font}`,`scrap-decor-${d.decorations}`]}
  get readerDesignStyles(){const d={...this.defaultScrapbookDesign(),...(this.readerPage?.design??{})};return{'--scrap-accent':d.customAccent||null,'--scrap-bg':d.customPaper||null}}
  private readerStorageKey(){return`reader-position-${this.readerTrip?.id??this.readerTrip?.title??'trip'}`}
  private restoreReaderPosition(){const saved=Number(localStorage.getItem(this.readerStorageKey())??0);this.readerIndex=Number.isFinite(saved)&&saved>=0&&saved<this.readerPages.length?saved:0}
  goToReaderPage(index:number,syncUrl=true){if(index<0||index>=this.readerPages.length)return;this.readerIndex=index;localStorage.setItem(this.readerStorageKey(),String(index));if(syncUrl&&!this.applyingRoute){const url=this.navigation.routeFor('reader',this.navigationContext());if(this.router.url!==url)void this.router.navigateByUrl(url,{replaceUrl:true})}}
  closeReader(){this.go(this.readerOrigin)}
  async deleteTrip(trip: Trip) {
    if (!confirm(`Supprimer « ${trip.title} » ?`)) return;
    try { await this.supabase.deleteTrip(trip.id); this.trips = this.trips.filter(t => t.id !== trip.id); this.go('trips'); this.notify('Voyage supprimé'); }
    catch (error) { this.notify(this.errorMessage(error)); }
  }
  async saveProfile() {
    try { const currentUser = await this.requireUser(); await this.supabase.saveProfile(currentUser.id, { username: this.user.username, firstname: this.user.firstname, bio: this.user.bio }); this.user.avatar = (this.user.firstname || 'V').charAt(0).toUpperCase(); this.notify('Profil mis à jour'); }
    catch (error) { this.notify(this.errorMessage(error)); }
  }
  async logout() { sessionStorage.removeItem(this.oauthReturnUrlKey);if(this.communityPollTimer){clearInterval(this.communityPollTimer);this.communityPollTimer=undefined}try { await this.supabase.signOut(); } catch {} this.userId='';this.travelerCompleted=false;this.selectedTrip = null; this.trips = []; this.inboxList=[];this.friendRequests=[];this.unreadMessageCount=0;this.pendingFriendCount=0;this.go('splash',true);this.notify('À bientôt, belle exploratrice !'); }
  notify(message: string) { this.toast = message; setTimeout(() => this.toast = '', 2800); }
  private setActionError(scope:string,message:string,retry:()=>Promise<void>){this.actionError={scope,message};this.retryCallback=retry}
  private clearActionError(scope:string){if(this.actionError?.scope===scope){this.actionError=null;this.retryCallback=null}}
  async retryLastAction(){const retry=this.retryCallback;if(!retry)return;this.actionError=null;this.retryCallback=null;await retry()}
  formatDate(date: string) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date + 'T12:00:00')); }
  formatMoney(value: number | null, currency: string) { return value == null ? 'À définir' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }

  private async loadAccount(userId: string, email: string,navigate=true) {
    try {
      this.userId=userId;
      const [profile, traveler, trips] = await Promise.all([this.supabase.profile(userId), this.supabase.travelerProfile(userId), this.supabase.trips(userId)]);
      this.user = { email, username: profile.username, firstname: profile.firstname, bio: profile.bio ?? '', avatar: (profile.firstname || 'V').charAt(0).toUpperCase() };
      this.travelerCompleted=!!traveler?.completed_at;
      if (traveler) this.questionnaire = { personality: traveler.personality ?? 'curieuse', anxiety: traveler.anxiety_level ?? 2, noise: traveler.noise_sensitivity ?? 2, crowd: traveler.crowd_sensitivity ?? 2, diet: (traveler.dietary_preferences ?? []).join(', '), allergies: (traveler.allergies ?? []).join(', '), mobility: traveler.mobility_preferences ?? '', notes: traveler.answers_json?.notes ?? '' };
      this.trips = trips.map(data => this.mapTrip(data));
      this.startCommunityPolling();
      if(navigate){const current=this.navigation.parse(this.router.url);const target=this.travelerCompleted?((current.screen==='auth'&&current.returnUrl)||this.consumeOAuthReturnUrl()||'/home'):'/onboarding';await this.router.navigateByUrl(target,{replaceUrl:true})}
    } catch (error) { this.notify(this.errorMessage(error)); }
  }
  private safeReturnUrl(value:string|null|undefined){
    if(!value||!value.startsWith('/')||value.startsWith('//'))return'';
    try{const parsed=new URL(value,window.location.origin);return parsed.origin===window.location.origin?`${parsed.pathname}${parsed.search}${parsed.hash}`:''}catch{return''}
  }
  private consumeOAuthReturnUrl(){
    const target=this.safeReturnUrl(sessionStorage.getItem(this.oauthReturnUrlKey));
    sessionStorage.removeItem(this.oauthReturnUrlKey);
    return target;
  }
  private oauthErrorFromUrl(value:string){
    try{
      const parsed=new URL(value,window.location.origin);
      const hash=new URLSearchParams(parsed.hash.replace(/^#/,''));
      return parsed.searchParams.get('error_description')||hash.get('error_description')||parsed.searchParams.get('error')||hash.get('error')||'';
    }catch{return''}
  }
  private mapTrip(data: any): Trip { return { id: data.id, title: data.title, country: data.country, startDate: data.start_date, endDate: data.end_date, currency: data.currency, budget: data.planned_budget == null ? null : Number(data.planned_budget), visibility: data.visibility, coverUrl:data.cover_url, days: (data.trip_days ?? []).sort((a: any, b: any) => a.day_number - b.day_number).map((day: any) => ({ id: day.id, date: day.day_date, label: `Jour ${day.day_number}`, note: day.notes ?? '' })) }; }
  private async requireUser() { const user = await this.supabase.currentUser(); if (!user) throw new Error('Ta session a expiré, reconnecte-toi.'); return user; }
  private toList(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean); }
  private errorMessage(error: unknown) {if(error instanceof Error)return error.message;if(error&&typeof error==='object'){const value=error as Record<string,unknown>;const message=String(value['message']??'');const details=String(value['details']??'');const hint=String(value['hint']??'');if(String(value['code']??'')==='PGRST204'&&message.includes('design_settings'))return 'La migration scrapbook n’est pas encore active dans Supabase. Exécute le dernier bloc de script.sql puis recharge le cache du schéma.';if(/sort_order|last_step|review_status|review_reason|confidence/.test(message))return 'Le centre de pilotage nécessite la migration 20260818_trip_command_center.sql. Exécute-la dans Supabase puis recharge le cache du schéma.';return[message,details,hint].filter(part=>part&&part!=='null'&&part!=='undefined').join(' · ')||'Une erreur est survenue avec Supabase.'}return'Une erreur est survenue avec Supabase.'; }
  private communityErrorMessage(error:unknown){const message=this.errorMessage(error);const errors:Record<string,string>={AUTH_REQUIRED:'Reconnecte-toi pour envoyer un message.',USER_NOT_FOUND:'Ce profil n’existe plus.',CANNOT_MESSAGE_SELF:'Tu ne peux pas t’écrire à toi-même.',USER_BLOCKED:'Cette interaction est impossible car un blocage est actif.',MESSAGES_DISABLED:'Cette personne n’accepte pas de nouveaux messages.',FOLLOW_REQUIRED:'Cette personne accepte uniquement les messages des voyageurs qu’elle suit.',FRIENDSHIP_REQUIRED:'Cette personne accepte uniquement les messages de ses amis.'};const code=Object.keys(errors).find(key=>message.includes(key));return code?errors[code]:message}
}

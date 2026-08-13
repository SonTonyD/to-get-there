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
      .select('*, trip_days(*, trip_media(id,storage_path,media_type,selected,created_at))').eq('owner_id', userId).order('start_date', { ascending: true });
    if (error) throw error;
    return Promise.all((data ?? []).map(async (trip: any) => {
      const photos=(trip.trip_days??[]).flatMap((day:any)=>day.trip_media??[]).filter((media:any)=>media.media_type==='photo'&&media.selected).sort((a:any,b:any)=>String(a.created_at).localeCompare(String(b.created_at)));
      const coverPath=trip.cover_image||photos[0]?.storage_path;
      if (!coverPath) return trip;
      if (/^https?:\/\//.test(coverPath)) return {...trip,cover_url:coverPath};
      const {data:signed}=await this.db.storage.from('trip-media').createSignedUrl(coverPath,3600);
      return {...trip,cover_url:signed?.signedUrl};
    }));
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

  async setTripCover(tripId: string, storagePath: string) {
    const { error } = await this.db.from('trips').update({ cover_image: storagePath }).eq('id', tripId);
    if (error) throw error;
  }

  async resolvePlace(candidate: any, country: string) {
    const { data, error } = await this.db.functions.invoke('resolve-place', { body: { name: candidate.name, city: candidate.city, country } });
    if (error) throw error;
    return data.results ?? [];
  }

  async confirmPlaceCandidate(candidate: any, match: any, dayId: string) {
    let placeId = match.existingPlaceId;
    if (!placeId) {
      const { data: place, error: placeError } = await this.db.from('places').upsert({
        provider: match.provider, provider_place_id: match.providerPlaceId, name: match.name,
        city: match.city, country: match.country, latitude: match.latitude,
        longitude: match.longitude, category: match.category || candidate.category
      }, { onConflict: 'provider,provider_place_id' }).select().single();
      if (placeError) throw placeError;
      placeId = place.id;
    }
    const { data: visit, error: visitError } = await this.db.from('place_visits').upsert({ trip_day_id: dayId, place_id: placeId, category: candidate.category }, { onConflict: 'trip_day_id,place_id' }).select().single();
    if (visitError) throw visitError;
    const { error } = await this.db.from('place_candidates').update({ status: 'confirmed', resolved_place_id: placeId }).eq('id', candidate.id);
    if (error) throw error;
    return { visit, match };
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

  async saveExpense(tripId: string, dayId: string, expense: { label: string; amount: number; currency: string; convertedAmount: number; convertedCurrency: string; category: string; date: string }) {
    const { error } = await this.db.from('expenses').insert({ trip_id: tripId, trip_day_id: dayId, label: expense.label, description: expense.label, amount: expense.amount, converted_amount: expense.convertedAmount, currency: expense.currency, converted_currency: expense.convertedCurrency, category: expense.category, expense_date: expense.date });
    if (error) throw error;
  }

  async expenses(tripId: string) { const { data, error } = await this.db.from('expenses').select('*').eq('trip_id', tripId).order('expense_date'); if (error) throw error; return data ?? []; }
  async placeVisits(tripId: string) { const { data, error } = await this.db.from('place_visits').select('*, places(*), trip_days!inner(id,day_date,trip_id)').eq('trip_days.trip_id', tripId); if (error) throw error; return data ?? []; }
  async tripStatistics(tripId: string) { const { data, error } = await this.db.rpc('trip_statistics', { target_trip: tripId }); if (error) throw error; return data; }
  async finishTrip(tripId: string) { const { data, error } = await this.db.rpc('finish_trip', { target_trip: tripId }); if (error) throw error; return data; }
  async publishTrip(tripId: string, settings: Record<string, unknown>) { const { data, error } = await this.db.functions.invoke('publish-trip', { body: { tripId, settings } }); if (error) throw error; return data.slug as string; }
  async explorePublicTrips() { const { data, error } = await this.db.from('trip_publications').select('slug,snapshot,published_at').order('published_at', { ascending: false }); if (error) throw error; return data ?? []; }

  async tripReader(tripId: string) {
    const { data, error } = await this.db.from('trip_days')
      .select('id,day_date,day_number,notes,day_journals(*,journal_events(*)),trip_media(*)')
      .eq('trip_id', tripId).order('day_number');
    if (error) throw error;
    return Promise.all((data ?? []).map(async (day: any) => ({
      ...day,
      trip_media: await Promise.all((day.trip_media ?? []).filter((media: any) => media.media_type === 'photo' && media.selected).map(async (media: any) => {
        const { data: signed } = await this.db.storage.from('trip-media').createSignedUrl(media.storage_path, 3600);
        return { ...media, url: signed?.signedUrl };
      }))
    })));
  }

  async communityProfile(userId: string) {
    const [{ data: profile, error }, { data: publications }, { data: countries }, { count: followers }, { count: following }] = await Promise.all([
      this.db.from('profiles').select('*').eq('id', userId).single(),
      this.db.from('trip_publications').select('slug,snapshot,published_at').eq('owner_id', userId).order('published_at', { ascending: false }),
      this.db.from('profile_countries').select('country').eq('user_id', userId),
      this.db.from('follows').select('*', { count: 'exact', head: true }).eq('followed_id', userId),
      this.db.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId)
    ]); if (error) throw error; return { profile, publications: publications ?? [], countries: (countries ?? []).map(c => c.country), followers: followers ?? 0, following: following ?? 0 };
  }
  async relationship(userId: string) { const me=await this.currentUser(); if(!me)return{}; const [{data:follow},{data:friendship},{data:block}]=await Promise.all([this.db.from('follows').select('id').eq('follower_id',me.id).eq('followed_id',userId).maybeSingle(),this.db.from('friendships').select('*').or(`and(requester_id.eq.${me.id},recipient_id.eq.${userId}),and(requester_id.eq.${userId},recipient_id.eq.${me.id})`).maybeSingle(),this.db.from('user_blocks').select('id').eq('blocker_id',me.id).eq('blocked_id',userId).maybeSingle()]);return{following:!!follow,friendship,blocked:!!block}; }
  async toggleFollow(userId:string,active:boolean){const me=await this.currentUser();if(!me)throw new Error('Non connecté');const query=this.db.from('follows');const{error}=active?await query.delete().eq('follower_id',me.id).eq('followed_id',userId):await query.insert({follower_id:me.id,followed_id:userId});if(error)throw error;}
  async requestFriend(userId:string){const me=await this.currentUser();if(!me)throw new Error('Non connecté');const{error}=await this.db.from('friendships').insert({requester_id:me.id,recipient_id:userId});if(error)throw error;}
  async friendshipRequests(){
    const me=await this.currentUser();
    if(!me)return[];
    const{data:requests,error}=await this.db.from('friendships').select('*').eq('recipient_id',me.id).eq('status','pending').order('created_at',{ascending:false});
    if(error)throw error;
    const requesterIds=[...new Set((requests??[]).map(request=>request.requester_id))];
    if(!requesterIds.length)return[];
    const{data:profiles,error:profileError}=await this.db.from('profiles').select('id,username,firstname,profile_picture').in('id',requesterIds);
    if(profileError)throw profileError;
    return(requests??[]).map(request=>({...request,requester:(profiles??[]).find(profile=>profile.id===request.requester_id)??null}));
  }
  async answerFriendship(id:string,status:'accepted'|'rejected'){const{error}=await this.db.from('friendships').update({status,accepted_at:status==='accepted'?new Date().toISOString():null}).eq('id',id);if(error)throw error;}
  async toggleLike(targetType:'trip'|'day'|'recommendation',targetId:string,active:boolean){const me=await this.currentUser();if(!me)throw new Error('Non connecté');const q=this.db.from('community_likes');const{error}=active?await q.delete().eq('user_id',me.id).eq('target_type',targetType).eq('target_id',targetId):await q.upsert({user_id:me.id,target_type:targetType,target_id:targetId},{onConflict:'user_id,target_type,target_id',ignoreDuplicates:true});if(error)throw error;}
  async tripEngagement(tripId:string){const me=await this.currentUser();const[{count},{data:mine},{data:saved}]=await Promise.all([this.db.from('community_likes').select('*',{count:'exact',head:true}).eq('target_type','trip').eq('target_id',tripId),me?this.db.from('community_likes').select('id').eq('user_id',me.id).eq('target_type','trip').eq('target_id',tripId).maybeSingle():Promise.resolve({data:null}),me?this.db.from('saved_trips').select('id').eq('user_id',me.id).eq('trip_id',tripId).maybeSingle():Promise.resolve({data:null})]);return{likes:count??0,liked:!!mine,saved:!!saved};}
  async comments(targetType:'trip'|'day',targetId:string){
    const{data:comments,error}=await this.db.from('comments').select('*').eq('target_type',targetType).eq('target_id',targetId).order('created_at');
    if(error)throw error;
    const authorIds=[...new Set((comments??[]).map(comment=>comment.user_id))];
    if(!authorIds.length)return[];
    const{data:profiles,error:profileError}=await this.db.from('profiles').select('id,username,firstname,profile_picture').in('id',authorIds);
    if(profileError)throw profileError;
    return(comments??[]).map(comment=>({...comment,author:(profiles??[]).find(profile=>profile.id===comment.user_id)??null}));
  }
  async addComment(targetType:'trip'|'day',targetId:string,content:string){const me=await this.currentUser();if(!me)throw new Error('Non connecté');const{error}=await this.db.from('comments').insert({user_id:me.id,target_type:targetType,target_id:targetId,content});if(error)throw error;}
  async deleteComment(id:string){const{error}=await this.db.from('comments').delete().eq('id',id);if(error)throw error;}
  async toggleSaveTrip(tripId:string,active:boolean){const me=await this.currentUser();if(!me)throw new Error('Non connecté');const q=this.db.from('saved_trips');const{error}=active?await q.delete().eq('user_id',me.id).eq('trip_id',tripId):await q.insert({user_id:me.id,trip_id:tripId});if(error)throw error;}
  async inspirations(){const me=await this.currentUser();if(!me)return[];const{data:saves,error}=await this.db.from('saved_trips').select('id,trip_id,created_at').eq('user_id',me.id).order('created_at',{ascending:false});if(error)throw error;if(!saves?.length)return[];const{data:publications,error:publicationError}=await this.db.from('trip_publications').select('trip_id,slug,snapshot').in('trip_id',saves.map(item=>item.trip_id));if(publicationError)throw publicationError;return saves.map(save=>({...save,publication:publications?.find(item=>item.trip_id===save.trip_id)})).filter(item=>item.publication);}
  async startConversation(userId:string){const{data,error}=await this.db.rpc('start_conversation',{other_user:userId});if(error)throw error;return data as string;}
  async inbox(){
    const me=await this.currentUser();
    if(!me)return[];
    const{data:mine,error}=await this.db.from('conversation_members').select('conversation_id,hidden_at').eq('user_id',me.id).is('hidden_at',null);
    if(error)throw error;
    const conversationIds=(mine??[]).map(item=>item.conversation_id);
    if(!conversationIds.length)return[];
    const[{data:conversations,error:conversationError},{data:members,error:memberError},{data:messages,error:messageError}]=await Promise.all([
      this.db.from('conversations').select('id,created_at').in('id',conversationIds),
      this.db.from('conversation_members').select('conversation_id,user_id').in('conversation_id',conversationIds),
      this.db.from('messages').select('id,conversation_id,sender_id,content,message_type,shared_entity_type,shared_entity_id,created_at').in('conversation_id',conversationIds).order('created_at',{ascending:true})
    ]);
    if(conversationError)throw conversationError;if(memberError)throw memberError;if(messageError)throw messageError;
    const messageIds=(messages??[]).map(message=>message.id);
    const{data:reads,error:readError}=messageIds.length?await this.db.from('message_reads').select('message_id,user_id,read_at').eq('user_id',me.id).in('message_id',messageIds):{data:[],error:null};
    if(readError)throw readError;
    const readIds=new Set((reads??[]).map(read=>read.message_id));
    const userIds=[...new Set((members??[]).map(member=>member.user_id))];
    const{data:profiles,error:profileError}=userIds.length?await this.db.from('profiles').select('id,username,firstname,profile_picture').in('id',userIds):{data:[],error:null};
    if(profileError)throw profileError;
    return(mine??[]).map(item=>({
      ...item,
      conversation:{
        ...(conversations??[]).find(conversation=>conversation.id===item.conversation_id),
        members:(members??[]).filter(member=>member.conversation_id===item.conversation_id).map(member=>({...member,profile:(profiles??[]).find(profile=>profile.id===member.user_id)??null})),
        messages:(messages??[]).filter(message=>message.conversation_id===item.conversation_id).map(message=>({...message,read:readIds.has(message.id)}))
      }
    })).sort((a,b)=>{
      const aMessages=a.conversation.messages;const bMessages=b.conversation.messages;
      const aDate=aMessages.at(-1)?.created_at??a.conversation.created_at??'';
      const bDate=bMessages.at(-1)?.created_at??b.conversation.created_at??'';
      return bDate.localeCompare(aDate);
    });
  }
  async conversation(id:string){const{data,error}=await this.db.from('messages').select('*').eq('conversation_id',id).order('created_at');if(error)throw error;return data??[];}
  async markConversationRead(id:string){const me=await this.currentUser();if(!me)return;const{data:messages,error}=await this.db.from('messages').select('id').eq('conversation_id',id).neq('sender_id',me.id);if(error)throw error;if(!messages?.length)return;const{error:readError}=await this.db.from('message_reads').upsert(messages.map(message=>({message_id:message.id,user_id:me.id})),{onConflict:'message_id,user_id',ignoreDuplicates:true});if(readError)throw readError;}
  async sendMessage(id:string,content:string,share?:{type:'trip'|'day'|'recommendation';id:string}){const{error}=await this.db.rpc('send_message',{target_conversation:id,body:content,msg_type:share?'share':'text',entity_type:share?.type??null,entity_id:share?.id??null});if(error)throw error;}
  async hideConversation(id:string){const me=await this.currentUser();if(!me)return;const{error}=await this.db.from('conversation_members').update({hidden_at:new Date().toISOString()}).eq('conversation_id',id).eq('user_id',me.id);if(error)throw error;}
  async blockUser(userId:string){const me=await this.currentUser();if(!me)return;const{error}=await this.db.from('user_blocks').upsert({blocker_id:me.id,blocked_id:userId});if(error)throw error;}
  async report(type:'user'|'comment'|'message',id:string,reason:string){const me=await this.currentUser();if(!me)return;const{error}=await this.db.from('reports').insert({reporter_id:me.id,target_type:type,target_id:id,reason});if(error)throw error;}
  async saveMessagePermission(value:'everyone'|'following'|'friends'|'nobody'){const me=await this.currentUser();if(!me)return;const{error}=await this.db.from('privacy_settings').update({message_permission:value}).eq('user_id',me.id);if(error)throw error;}
}

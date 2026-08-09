import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{
  const auth=req.headers.get('Authorization');if(!auth)throw new Error('Non authentifié');
  const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const{data:{user}}=await userClient.auth.getUser();if(!user)throw new Error('Session invalide');
  const{tripId,settings}=await req.json();
  const{data:slug,error:publishError}=await userClient.rpc('publish_trip',{target_trip:tripId,settings});if(publishError)throw publishError;
  const folder=`${user.id}/${tripId}`;const{data:old}=await admin.storage.from('published-trip-media').list(folder,{limit:1000});if(old?.length)await admin.storage.from('published-trip-media').remove(old.map(item=>`${folder}/${item.name}`));
  const photoUrls:string[]=[];
  if(settings.photos){const{data:media,error}=await userClient.from('trip_media').select('storage_path,original_name,trip_days!inner(trip_id)').eq('trip_days.trip_id',tripId).eq('media_type','photo').eq('selected',true);if(error)throw error;
    for(const item of media??[]){const{data:file,error:downloadError}=await userClient.storage.from('trip-media').download(item.storage_path);if(downloadError)continue;const name=`${folder}/${crypto.randomUUID()}.${item.storage_path.split('.').pop()??'jpg'}`;const{error:uploadError}=await admin.storage.from('published-trip-media').upload(name,file,{contentType:file.type,upsert:true});if(!uploadError)photoUrls.push(admin.storage.from('published-trip-media').getPublicUrl(name).data.publicUrl);}
  }
  const{data:publication}=await admin.from('trip_publications').select('snapshot').eq('trip_id',tripId).single();if(publication)await admin.from('trip_publications').update({snapshot:{...publication.snapshot,photos:photoUrls}}).eq('trip_id',tripId);
  return Response.json({slug},{headers:cors});
}catch(error){return Response.json({error:error instanceof Error?error.message:'Erreur de publication'},{status:400,headers:cors});}});

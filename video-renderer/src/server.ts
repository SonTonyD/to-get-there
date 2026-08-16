import express from 'express';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FilmProps } from './types.js';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value};
const supabase=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'));
const app=express();app.use(express.json());
let bundleUrlPromise:Promise<string>|undefined;
const bundleUrl=()=>bundleUrlPromise??=(bundle({entryPoint:path.resolve(process.cwd(),'src/entry.ts')}));

async function run(renderId:string){
  const update=(values:Record<string,unknown>)=>supabase.from('video_renders').update(values).eq('id',renderId);
  try{
    await update({status:'preparing',progress:5,started_at:new Date().toISOString()});
    const {data:render,error}=await supabase.from('video_renders').select('*,video_projects(*,video_scenes(*))').eq('id',renderId).single();if(error)throw error;
    const project=render.video_projects;const scenes=(project.video_scenes??[]).sort((a:any,b:any)=>a.position-b.position);
    const ids=[...new Set(scenes.flatMap((scene:any)=>scene.media_ids??[]))];
    const {data:rows,error:mediaError}=ids.length?await supabase.from('trip_media').select('id,storage_path,media_type').in('id',ids):{data:[],error:null};if(mediaError)throw mediaError;
    const media=await Promise.all((rows??[]).map(async(row:any)=>{const{data}=await supabase.storage.from('trip-media').createSignedUrl(row.storage_path,14400);return{...row,url:data?.signedUrl}}));
    const music=String(project.style_settings?.music??'none');const musicUrl=music==='none'?undefined:process.env[`MUSIC_${music.toUpperCase()}_URL`];
    const props:FilmProps={project,scenes:scenes.map((scene:any)=>({...scene,duration:Number(scene.duration),media:(scene.media_ids??[]).map((id:string)=>media.find(item=>item.id===id)).filter(Boolean)})),musicUrl};
    const serveUrl=await bundleUrl();const composition=await selectComposition({serveUrl,id:'MemoryFilm',inputProps:props});
    const folder=path.join(tmpdir(),'to-get-there-renders');await mkdir(folder,{recursive:true});const output=path.join(folder,`${renderId}.mp4`);let last=0;
    await update({status:'rendering',progress:12});
    await renderMedia({composition,serveUrl,codec:'h264',outputLocation:output,inputProps:props,onProgress:({progress})=>{const next=12+Math.floor(progress*78);if(next>=last+4){last=next;void update({progress:next})}}});
    await update({status:'uploading',progress:92});const storagePath=`${render.user_id}/${renderId}.mp4`;const file=await readFile(output);
    const {error:uploadError}=await supabase.storage.from('video-renders').upload(storagePath,file,{contentType:'video/mp4',upsert:true});if(uploadError)throw uploadError;await unlink(output);
    await update({status:'completed',progress:100,storage_path:storagePath,completed_at:new Date().toISOString()});await supabase.from('video_projects').update({status:'ready'}).eq('id',project.id);
  }catch(error){await update({status:'failed',error_message:error instanceof Error?error.message:String(error),completed_at:new Date().toISOString()});}
}

app.get('/health',(_req,res)=>res.json({ok:true}));
app.post('/render',(req,res)=>{if(req.header('x-render-secret')!==required('VIDEO_RENDERER_SECRET')){res.status(401).json({error:'unauthorized'});return}const renderId=String(req.body?.renderId??'');if(!renderId){res.status(400).json({error:'renderId required'});return}res.status(202).json({accepted:true,renderId});void run(renderId)});
app.listen(Number(process.env.PORT??8080),()=>console.log('Video renderer ready'));

import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { FilmProps, FilmScene } from './types.js';

const palettes:Record<string,{accent:string;paper:string;ink:string}>={
  candy:{accent:'#ff62b0',paper:'#fff4df',ink:'#4f365c'},sunset:{accent:'#f49b52',paper:'#fff0df',ink:'#63372c'},
  ocean:{accent:'#38bdf8',paper:'#eafaff',ink:'#164e63'},forest:{accent:'#90a955',paper:'#f2f7e8',ink:'#344e41'},
  nocturne:{accent:'#ff70a6',paper:'#251b2e',ink:'#fff1ff'}
};

const Scene:React.FC<{scene:FilmScene;localFrame:number;frames:number;index:number;palette:any;showText:boolean}>=({scene,localFrame,frames,index,palette,showText})=>{
  const media=scene.media[0];const opacity=interpolate(localFrame,[0,8,Math.max(9,frames-10),frames],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const scale=interpolate(localFrame,[0,frames],[1.02,1.1]);
  return <AbsoluteFill style={{backgroundColor:palette.paper,opacity,overflow:'hidden'}}>
    {media?.media_type==='video'?<OffthreadVideo muted src={media.url} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${scale})`}}/>:media?<Img src={media.url} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${scale})`}}/>:<AbsoluteFill style={{justifyContent:'center',alignItems:'center',fontSize:120,color:palette.accent}}>✦</AbsoluteFill>}
    <AbsoluteFill style={{background:'linear-gradient(180deg,transparent 32%,rgba(25,14,30,.86))'}}/>
    <div style={{position:'absolute',left:'7%',right:'7%',bottom:'8%',color:'white',fontFamily:'Arial, sans-serif',textAlign:scene.scene_type==='intro'||scene.scene_type==='outro'?'center':'left'}}>
      {showText&&<><div style={{fontSize:24,fontWeight:900,letterSpacing:8,textTransform:'uppercase',color:palette.accent}}>Souvenir {String(index+1).padStart(2,'0')}</div><h1 style={{fontSize:72,lineHeight:.95,margin:'16px 0',textShadow:'0 4px 22px #000'}}>{scene.title}</h1><p style={{fontSize:30,lineHeight:1.35,margin:0}}>{scene.caption}</p></>}
    </div><div style={{position:'absolute',top:'4%',left:'45%',width:120,height:30,backgroundColor:palette.accent,opacity:.78,transform:'rotate(-3deg)'}}/>
  </AbsoluteFill>;
};

export const MemoryFilm:React.FC<FilmProps>=({project,scenes,musicUrl})=>{
  const frame=useCurrentFrame();const {fps}=useVideoConfig();let cursor=0;let active=scenes[0];let local=frame;let activeFrames=Math.round(Number(active?.duration??1)*fps);let index=0;
  for(let i=0;i<scenes.length;i++){const count=Math.round(Number(scenes[i].duration)*fps);if(frame>=cursor&&frame<cursor+count){active=scenes[i];local=frame-cursor;activeFrames=count;index=i;break}cursor+=count}
  const style=project.style_settings??{};const palette=palettes[style.palette]??palettes.candy;
  return <AbsoluteFill>{active&&<Scene scene={active} localFrame={local} frames={activeFrames} index={index} palette={palette} showText={style.showText!==false}/>} {musicUrl&&<Audio src={musicUrl} volume={.22}/>}</AbsoluteFill>;
};

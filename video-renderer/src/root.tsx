import React from 'react';
import { Composition } from 'remotion';
import { MemoryFilm } from './video.js';
import type { FilmProps } from './types.js';

export const VideoRoot:React.FC=()=> <Composition
  id="MemoryFilm" component={MemoryFilm} fps={30} width={1080} height={1920} durationInFrames={900}
  defaultProps={{project:{format:'vertical',style_settings:{}},scenes:[]}}
  calculateMetadata={({props}:{props:FilmProps})=>({
    durationInFrames:Math.max(30,Math.round(props.scenes.reduce((sum,scene)=>sum+Number(scene.duration),0)*30)),
    width:props.project.format==='horizontal'?1920:1080,
    height:props.project.format==='horizontal'?1080:1920
  })}
/>;

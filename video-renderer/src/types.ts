export type FilmScene = { id:string; scene_type:string; duration:number; title:string; caption:string; media_ids:string[]; settings:Record<string,unknown>; media:Array<{id:string;url:string;media_type:string}> };
export type FilmProps = { project:any; scenes:FilmScene[]; musicUrl?:string };

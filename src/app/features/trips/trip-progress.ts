export type JournalStep=1|2|3|4;
export type DayProgressState='empty'|'media'|'draft'|'review'|'complete';
export interface DayProgress {dayId:string;number:number;date:string;state:DayProgressState;label:string;detail:string;step:JournalStep;photoCount:number;unusedPhotos:number;pendingPlaces:number;pendingEvents:number;expenseCount:number;title:string;}

export function buildTripDayProgress(rows:any[]):DayProgress[]{
  return rows.map((row:any)=>{
    const journal=Array.isArray(row.day_journals)?row.day_journals[0]:row.day_journals;
    const media=row.trip_media??[];const photos=media.filter((item:any)=>item.media_type==='photo');
    const unusedPhotos=photos.filter((item:any)=>item.selected===false).length;
    const pendingPlaces=(journal?.place_candidates??[]).filter((item:any)=>item.status==='pending').length;
    const pendingEvents=(journal?.journal_events??[]).filter((item:any)=>item.review_status==='pending').length;
    const expenseCount=(row.expenses??[]).length;const hasNarrative=!!String(journal?.raw_text??'').trim();
    const generated=!!journal?.title||(journal?.journal_events??[]).length>0;
    let state:DayProgressState='empty';let label='À commencer';let step:JournalStep=1;
    if(journal?.status==='published'){state='complete';label='Carnet terminé';step=4}
    else if(generated&&(pendingPlaces+pendingEvents)>0){state='review';label='À vérifier';step=3}
    else if(generated){state='draft';label='Prêt à finaliser';step=4}
    else if(hasNarrative){state='draft';label='Récit à structurer';step=2}
    else if(media.length){state='media';label=`${photos.length} photo${photos.length>1?'s':''}, aucun récit`;step=2}
    const saved=Number(journal?.last_step??0);if(saved>=1&&saved<=4&&state!=='complete')step=saved as JournalStep;
    const detail=state==='complete'?(journal?.title||'Journée racontée'):state==='review'?`${pendingPlaces+pendingEvents} élément${pendingPlaces+pendingEvents>1?'s':''} incertain${pendingPlaces+pendingEvents>1?'s':''}`:state==='empty'?'Aucun souvenir ajouté':state==='media'?label:generated?(journal?.title||'Brouillon généré'):'Le récit attend la génération';
    return{dayId:row.id,number:row.day_number,date:row.day_date,state,label,detail,step,photoCount:photos.length,unusedPhotos,pendingPlaces,pendingEvents,expenseCount,title:journal?.title??''};
  });
}

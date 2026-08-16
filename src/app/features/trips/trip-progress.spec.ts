import { buildTripDayProgress } from './trip-progress';

describe('buildTripDayProgress',()=>{
  const day=(overrides:any={})=>({id:'day',day_number:1,day_date:'2026-08-10',trip_media:[],expenses:[],day_journals:null,...overrides});

  it('distinguishes an empty day from a media-only day',()=>{
    expect(buildTripDayProgress([day()])[0].state).toBe('empty');
    const media=buildTripDayProgress([day({trip_media:[{media_type:'photo',selected:true}]})])[0];
    expect(media.state).toBe('media');expect(media.step).toBe(2);
  });

  it('sends generated uncertain content to review',()=>{
    const journal={title:'Arrivée',status:'draft',journal_events:[{review_status:'pending'}],place_candidates:[{status:'pending'}]};
    const progress=buildTripDayProgress([day({day_journals:journal})])[0];
    expect(progress.state).toBe('review');expect(progress.pendingEvents+progress.pendingPlaces).toBe(2);expect(progress.step).toBe(3);
  });

  it('marks a published journal as complete',()=>{
    const progress=buildTripDayProgress([day({day_journals:{title:'Une belle journée',status:'published'}})])[0];
    expect(progress.state).toBe('complete');expect(progress.step).toBe(4);
  });
});

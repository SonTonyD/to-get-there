import { TestBed } from '@angular/core/testing';
import { TravelReaderComponent } from './travel-reader.component';

describe('TravelReaderComponent',()=>{
  beforeEach(async()=>{await TestBed.configureTestingModule({imports:[TravelReaderComponent]}).compileComponents()});

  it('emits the next valid page index',()=>{
    const fixture=TestBed.createComponent(TravelReaderComponent);
    const reader=fixture.componentInstance;
    reader.pages=[{kind:'cover'},{kind:'day'}];reader.index=0;
    let selected=-1;reader.indexChange.subscribe(index=>selected=index);
    reader.next();
    expect(reader.index).toBe(1);expect(selected).toBe(1);
  });

  it('does not navigate beyond the last page',()=>{
    const fixture=TestBed.createComponent(TravelReaderComponent);
    const reader=fixture.componentInstance;
    reader.pages=[{kind:'cover'}];reader.index=0;reader.next();
    expect(reader.index).toBe(0);
  });
});

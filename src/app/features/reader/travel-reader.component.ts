import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector:'app-travel-reader',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./travel-reader.component.html',
  styleUrl:'./travel-reader.component.css'
})
export class TravelReaderComponent {
  @Input({required:true}) pages:any[]=[];
  @Input({required:true}) trip:any=null;
  @Input() index=0;
  @Input() designClasses:string[]=[];
  @Input() designStyles:Record<string,string|null>={};
  @Output() indexChange=new EventEmitter<number>();
  @Output() closeRequested=new EventEmitter<void>();
  @Output() notice=new EventEmitter<string>();

  tocOpen=false;
  lightbox='';
  private touchX=0;

  constructor(private readonly element:ElementRef<HTMLElement>){}

  get page(){return this.pages[this.index]??null}

  goTo(index:number){
    if(index<0||index>=this.pages.length)return;
    this.index=index;this.tocOpen=false;this.indexChange.emit(index);
  }

  previous(){this.goTo(this.index-1)}
  next(){this.goTo(this.index+1)}
  touchStart(event:TouchEvent){this.touchX=event.changedTouches[0]?.clientX??0}
  touchEnd(event:TouchEvent){const delta=(event.changedTouches[0]?.clientX??0)-this.touchX;if(Math.abs(delta)>55)(delta<0?this.next():this.previous())}

  async toggleFullscreen(){
    try{if(!document.fullscreenElement)await this.element.nativeElement.requestFullscreen();else await document.exitFullscreen()}
    catch{this.notice.emit('Le plein écran n’est pas disponible sur cet appareil.')}
  }

  async shareDay(){
    if(this.page?.kind!=='day')return;
    const text=`${this.page.title} · Jour ${this.page.number} de ${this.trip?.title}`;
    try{
      if(navigator.share)await navigator.share({title:this.page.title,text,url:location.href});
      else{await navigator.clipboard.writeText(`${text} ${location.href}`);this.notice.emit('Lien de la journée copié')}
    }catch{/* Closing the native share sheet is not an application error. */}
  }

  formatDate(date:string){return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${date}T12:00:00`))}

  @HostListener('window:keydown',['$event']) onKey(event:KeyboardEvent){
    if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();this.next()}
    if(event.key==='ArrowLeft')this.previous();
    if(event.key==='Escape')this.closeRequested.emit();
  }
}

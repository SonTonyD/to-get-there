import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-travel-reader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './travel-reader.component.html',
  styleUrl: './travel-reader.component.css',
})
export class TravelReaderComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) pages: any[] = [];
  @Input({ required: true }) trip: any = null;
  @Input() index = 0;
  @Input() designClasses: string[] = [];
  @Input() designStyles: Record<string, string | null> = {};
  @Output() indexChange = new EventEmitter<number>();
  @Output() closeRequested = new EventEmitter<void>();
  @Output() notice = new EventEmitter<string>();

  tocOpen = false;
  focusMode = false;
  ambientPlaying = false;
  lightbox: { url: string; caption?: string } | null = null;
  turnDirection: 'next' | 'previous' | '' = '';
  private touchX = 0;
  private turnTimer?: ReturnType<typeof setTimeout>;
  private scrollFrame = 0;
  private emittedIndex?: number;
  private audioContext?: AudioContext;
  private ambientGain?: GainNode;
  private ambientOscillators: OscillatorNode[] = [];
  private ambientTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly element: ElementRef<HTMLElement>) {}

  get page() { return this.pages[this.index] ?? null; }
  get spreadStart() { return this.index === 0 ? 0 : (this.index % 2 === 1 ? this.index : this.index - 1); }
  get spreadPages() {
    if (!this.pages.length) return [];
    if (this.spreadStart === 0) return [{ item: this.pages[0], index: 0 }];
    return [this.spreadStart, this.spreadStart + 1]
      .filter(index => index < this.pages.length)
      .map(index => ({ item: this.pages[index], index }));
  }

  ngAfterViewInit() { this.scrollToMobilePage(false); }
  ngOnChanges(changes: SimpleChanges) {
    if (!changes['index'] || changes['index'].firstChange) return;
    if (changes['index'].currentValue === this.emittedIndex) { this.emittedIndex = undefined; return; }
    this.scrollToMobilePage(false);
  }
  ngOnDestroy() {
    clearTimeout(this.turnTimer);
    cancelAnimationFrame(this.scrollFrame);
    this.stopAmbient();
  }

  isMobile() { return matchMedia('(max-width: 760px)').matches; }

  goTo(index: number, scroll = true) {
    if (index < 0 || index >= this.pages.length) return;
    if (index === this.index) { if (scroll) this.scrollToMobilePage(); return; }
    this.turnDirection = index > this.index ? 'next' : 'previous';
    this.index = index;
    this.tocOpen = false;
    this.emittedIndex = index;
    this.indexChange.emit(index);
    clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => this.turnDirection = '', 620);
    if (scroll) this.scrollToMobilePage();
  }

  activatePage(index: number) {
    if (index !== this.index) { this.index = index; this.emittedIndex = index; this.indexChange.emit(index); }
  }

  previous() {
    if (this.isMobile()) { this.goTo(this.index - 1); return; }
    this.goTo(this.spreadStart <= 1 ? 0 : this.spreadStart - 2);
  }
  next() {
    if (this.isMobile()) { this.goTo(this.index + 1); return; }
    this.goTo(this.spreadStart === 0 ? 1 : this.spreadStart + 2);
  }
  get hasPrevious() { return this.spreadStart > 0; }
  get hasNext() { return this.spreadStart === 0 ? this.pages.length > 1 : this.spreadStart + 2 < this.pages.length; }

  touchStart(event: TouchEvent) { this.touchX = event.changedTouches[0]?.clientX ?? 0; }
  touchEnd(event: TouchEvent) {
    if (!this.isMobile()) return;
    const delta = (event.changedTouches[0]?.clientX ?? 0) - this.touchX;
    if (Math.abs(delta) > 70) (delta < 0 ? this.next() : this.previous());
  }

  mobileScroll() {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      const container = this.element.nativeElement.querySelector<HTMLElement>('.reader-mobile-flow');
      if (!container) return;
      const top = container.getBoundingClientRect().top + 24;
      const pages = [...container.querySelectorAll<HTMLElement>('.mobile-reader-page')];
      if (!pages.length) return;
      const closest = pages.reduce((best, item) =>
        Math.abs(item.getBoundingClientRect().top - top) < Math.abs(best.getBoundingClientRect().top - top) ? item : best,
      pages[0]);
      const nextIndex = Number(closest?.dataset['pageIndex'] ?? this.index);
      if (Number.isInteger(nextIndex) && nextIndex !== this.index) {
        this.index = nextIndex;
        this.emittedIndex = nextIndex;
        this.indexChange.emit(nextIndex);
      }
    });
  }

  private scrollToMobilePage(smooth = true) {
    if (!this.isMobile()) return;
    setTimeout(() => this.element.nativeElement
      .querySelector<HTMLElement>(`[data-page-index="${this.index}"]`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
  }

  pageClasses(item: any) {
    const design = item?.design ?? {};
    return [
      `composition-${item?.composition ?? 'classic'}`,
      `scrap-style-${design.style ?? 'wanderlust'}`,
      `scrap-palette-${design.palette ?? 'candy'}`,
      `scrap-paper-${design.paper ?? 'grid'}`,
      `scrap-font-${design.font ?? 'handwritten'}`,
      `scrap-decor-${design.decorations ?? 'balanced'}`,
    ];
  }
  pageStyles(item: any) {
    return { '--scrap-accent': item?.design?.customAccent || null, '--scrap-bg': item?.design?.customPaper || null };
  }
  visiblePhotos(item: any): any[] { return (item?.photos ?? []).slice(0, item?.composition === 'contact' ? 9 : 4); }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await this.element.nativeElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { this.notice.emit('Le plein écran n’est pas disponible sur cet appareil.'); }
  }

  toggleFocusMode() { this.focusMode = !this.focusMode; this.tocOpen = false; }

  async toggleAmbient() {
    if (this.ambientPlaying) { this.stopAmbient(); return; }
    try {
      this.audioContext = new AudioContext();
      this.ambientGain = this.audioContext.createGain();
      this.ambientGain.gain.setValueAtTime(.0001, this.audioContext.currentTime);
      this.ambientGain.gain.exponentialRampToValueAtTime(.028, this.audioContext.currentTime + 2.5);
      this.ambientGain.connect(this.audioContext.destination);
      const frequencies = [130.81, 196, 261.63];
      this.ambientOscillators = frequencies.map((frequency, index) => {
        const oscillator = this.audioContext!.createOscillator();
        const gain = this.audioContext!.createGain();
        oscillator.type = index === 1 ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.value = index === 0 ? .5 : .18;
        oscillator.connect(gain).connect(this.ambientGain!);
        oscillator.start();
        return oscillator;
      });
      let chord = 0;
      this.ambientTimer = setInterval(() => {
        chord = (chord + 1) % 3;
        const ratios = [1, 1.122, .89];
        this.ambientOscillators.forEach((oscillator, index) =>
          oscillator.frequency.exponentialRampToValueAtTime(frequencies[index] * ratios[chord], this.audioContext!.currentTime + 4));
      }, 7000);
      this.ambientPlaying = true;
    } catch { this.notice.emit('L’ambiance sonore n’est pas disponible sur cet appareil.'); }
  }

  private stopAmbient() {
    clearInterval(this.ambientTimer);
    this.ambientTimer = undefined;
    const context = this.audioContext;
    const oscillators = [...this.ambientOscillators];
    if (this.ambientGain && context) {
      this.ambientGain.gain.cancelScheduledValues(context.currentTime);
      this.ambientGain.gain.setTargetAtTime(.0001, context.currentTime, .15);
    }
    this.ambientOscillators = [];
    this.audioContext = undefined;
    this.ambientGain = undefined;
    setTimeout(() => {
      oscillators.forEach(oscillator => { try { oscillator.stop(); } catch {} });
      void context?.close();
    }, 500);
    this.ambientPlaying = false;
  }

  openPhoto(photo: any) { this.lightbox = typeof photo === 'string' ? { url: photo } : photo; }

  async shareDay(item = this.page, pageIndex = this.index) {
    if (item?.kind !== 'day') return;
    this.activatePage(pageIndex);
    const text = `${item.title} · Jour ${item.number} de ${this.trip?.title}`;
    const url = location.href.replace(/\/read\/\d+(?=($|[?#]))/, `/read/${pageIndex + 1}`);
    try {
      if (navigator.share) await navigator.share({ title: item.title, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); this.notice.emit('Lien de la journée copié'); }
    } catch { /* Closing the native share sheet is not an application error. */ }
  }

  formatDate(date: string) {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${date}T12:00:00`));
  }

  tocLabel(item: any) {
    return item.kind === 'cover' ? 'Couverture'
      : item.kind === 'timeline' ? 'Le voyage en un regard'
      : item.kind === 'map' ? 'Carte des étapes'
      : item.kind === 'end' ? 'Souvenirs et chiffres'
      : item.title;
  }

  tocMeta(item: any) {
    if (item.kind === 'day') return `Jour ${item.number} · ${this.formatDate(item.date)}`;
    if (item.kind === 'map') return item.cities?.join(' → ') ?? '';
    return '';
  }

  @HostListener('window:keydown', ['$event']) onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.lightbox) { this.lightbox = null; return; }
      if (this.tocOpen) { this.tocOpen = false; return; }
      if (this.focusMode) { this.focusMode = false; return; }
      this.closeRequested.emit(); return;
    }
    if (this.isMobile()) return;
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); this.next(); }
    if (event.key === 'ArrowLeft') this.previous();
  }
}

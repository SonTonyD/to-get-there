import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserVideoProgress, BrowserVideoRendererService } from './browser-video-renderer.service';

export type ShareScope = 'trip' | 'day' | 'selection';
export type ShareDestination = 'reel' | 'tiktok' | 'story' | 'carousel' | 'card';
type SharePalette = 'candy' | 'sunset' | 'ocean' | 'forest' | 'nocturne';

export interface ShareStudioSource {
  trip: { id?: string; title: string; country: string; startDate?: string; endDate?: string };
  days: Array<{ id?: string; number: number; date: string; title: string; summary: string; events?: any[] }>;
  media: Array<{ id: string; trip_day_id?: string; url: string; caption?: string; media_type?: string }>;
  stats?: any;
  places?: any[];
  author?: string;
  publicUrl?: string;
  initialDayId?: string;
}

interface ShareVisual {
  kind: 'cover' | 'memory' | 'route' | 'stats' | 'recommendation' | 'cta' | 'day';
  title: string;
  subtitle: string;
  photo?: string;
  kicker?: string;
  details?: string[];
}

const PALETTES: Record<SharePalette, { paper: string; ink: string; accent: string; pop: string; soft: string }> = {
  candy: { paper: '#fff7e8', ink: '#4f365c', accent: '#ff62b0', pop: '#ffe070', soft: '#b8f2e6' },
  sunset: { paper: '#fff1df', ink: '#63372c', accent: '#e85d3f', pop: '#ffd166', soft: '#f7b267' },
  ocean: { paper: '#eafaff', ink: '#164e63', accent: '#0284c7', pop: '#7dd3fc', soft: '#a7f3d0' },
  forest: { paper: '#f2f7e8', ink: '#344e41', accent: '#66823e', pop: '#d7e68a', soft: '#cde8c8' },
  nocturne: { paper: '#251b2e', ink: '#fff1ff', accent: '#ff70a6', pop: '#c8b6ff', soft: '#764ba2' }
};

@Component({
  selector: 'app-share-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './share-studio.component.html',
  styleUrl: './share-studio.component.css'
})
export class ShareStudioComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) source!: ShareStudioSource;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() notice = new EventEmitter<string>();

  step: 1 | 2 | 3 | 4 = 1;
  scope: ShareScope = 'trip';
  destination: ShareDestination = 'reel';
  selectedDayId = '';
  selectedMediaIds: string[] = [];
  title = '';
  subtitle = '';
  caption = '';
  duration: 15 | 30 | 45 = 30;
  palette: SharePalette = 'candy';
  showText = true;
  visuals: ShareVisual[] = [];
  previewIndex = 0;
  busy = false;
  progress: BrowserVideoProgress | null = null;
  error = '';
  videoUrl = '';
  private videoBlob: Blob | null = null;

  constructor(readonly videoRenderer: BrowserVideoRendererService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['source'] || !this.source) return;
    const initial = this.source.initialDayId || '';
    this.scope = initial ? 'day' : 'trip';
    this.selectedDayId = initial || this.source.days[0]?.id || '';
    this.selectedMediaIds = this.defaultMedia().map(item => item.id);
    this.title = initial ? (this.selectedDay?.title || this.source.trip.title) : this.source.trip.title;
    this.subtitle = initial ? (this.selectedDay?.summary || this.source.trip.country) : this.tripSubtitle;
    this.caption = `${this.title} ✦ ${this.source.trip.country}\n\nUn souvenir à retrouver dans mon carnet de voyage.`;
    this.rebuildDraft();
  }
  ngOnDestroy() { this.resetVideo(); }

  get selectedDay() { return this.source.days.find(day => day.id === this.selectedDayId) ?? this.source.days[0]; }
  get photos() { return (this.source.media ?? []).filter(item => (!item.media_type || item.media_type === 'photo') && !!item.url); }
  get selectedPhotos() {
    const selected = this.photos.filter(item => this.selectedMediaIds.includes(item.id));
    return selected.length ? selected : this.defaultMedia();
  }
  get currentVisual(): ShareVisual { return this.visuals[this.previewIndex] ?? this.visuals[0] ?? { kind: 'cover', title: this.title, subtitle: this.subtitle }; }
  get isVideo() { return this.destination === 'reel' || this.destination === 'tiktok'; }
  get outputLabel() {
    const labels: Record<ShareDestination, string> = { reel: 'Reel Instagram', tiktok: 'TikTok', story: 'Story', carousel: 'Carrousel Instagram', card: 'Carte souvenir' };
    return labels[this.destination];
  }
  get dimensionsLabel() { return this.destination === 'carousel' || this.destination === 'card' ? '1080 × 1350' : '1080 × 1920'; }
  get tripSubtitle() {
    const days = this.source.days.length;
    return `${days || 1} jour${days > 1 ? 's' : ''} · ${this.source.trip.country}`;
  }
  get canNativeShare() { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }

  setStep(value: number) {
    if (value < 1 || value > 4) return;
    this.step = value as 1 | 2 | 3 | 4;
    if (this.step === 4) this.rebuildDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  next() { this.setStep(this.step + 1); }
  previous() { this.setStep(this.step - 1); }
  setScope(scope: ShareScope) {
    this.scope = scope;
    if (scope === 'day' && !this.selectedDayId) this.selectedDayId = this.source.days[0]?.id || '';
    this.selectedMediaIds = this.defaultMedia().map(item => item.id);
    this.applySuggestedCopy();
    this.rebuildDraft();
  }
  chooseDay(id: string) {
    this.selectedDayId = id;
    this.selectedMediaIds = this.defaultMedia().map(item => item.id);
    this.applySuggestedCopy();
    this.rebuildDraft();
  }
  chooseDestination(destination: ShareDestination) {
    this.destination = destination;
    if (destination === 'card' && this.scope === 'trip') this.scope = 'day';
    this.previewIndex = 0;
    this.resetVideo();
    this.rebuildDraft();
  }
  toggleMedia(id: string) {
    const index = this.selectedMediaIds.indexOf(id);
    if (index >= 0) this.selectedMediaIds.splice(index, 1);
    else if (this.selectedMediaIds.length < 10) this.selectedMediaIds.push(id);
    this.rebuildDraft();
  }
  updateDraft() { this.resetVideo(); this.rebuildDraft(); }
  preview(index: number) { if (index >= 0 && index < this.visuals.length) this.previewIndex = index; }

  async download() {
    if (this.isVideo) await this.exportVideo(false);
    else await this.exportImages(false);
  }
  async share() {
    if (this.isVideo) await this.exportVideo(true);
    else await this.exportImages(true);
  }
  async copyCaption() {
    try { await navigator.clipboard.writeText(this.caption); this.notice.emit('Légende copiée'); }
    catch { this.notice.emit('Impossible de copier la légende sur cet appareil.'); }
  }

  private defaultMedia() {
    const scoped = this.scope === 'day' && this.selectedDayId
      ? this.photos.filter(item => item.trip_day_id === this.selectedDayId)
      : this.photos;
    return scoped.slice(0, this.scope === 'selection' ? 6 : 10);
  }
  private applySuggestedCopy() {
    if (this.scope === 'day') {
      this.title = this.selectedDay?.title || this.source.trip.title;
      this.subtitle = this.selectedDay?.summary || `${this.source.trip.country} · ${this.selectedDay?.date || ''}`;
    } else {
      this.title = this.source.trip.title;
      this.subtitle = this.tripSubtitle;
    }
    this.caption = `${this.title} ✦ ${this.source.trip.country}\n\nUn souvenir à retrouver dans mon carnet de voyage.`;
  }
  private rebuildDraft() {
    const photos = this.selectedPhotos;
    const cities = this.itinerary();
    const recommendation = this.recommendation();
    const cover: ShareVisual = { kind: 'cover', kicker: 'CARNET DE VOYAGE', title: this.title || this.source.trip.title, subtitle: this.subtitle || this.tripSubtitle, photo: photos[0]?.url };
    const memory: ShareVisual = { kind: 'memory', kicker: 'UN SOUVENIR À GARDER', title: this.scope === 'day' ? this.selectedDay?.title || 'Une journée ailleurs' : 'Quelques instants ailleurs', subtitle: this.scope === 'day' ? this.selectedDay?.summary || this.source.trip.country : this.source.trip.country, photo: photos[1]?.url || photos[0]?.url };
    const route: ShareVisual = { kind: 'route', kicker: 'L’ITINÉRAIRE', title: 'D’ici à là', subtitle: this.source.trip.country, details: cities.length ? cities : this.source.days.slice(0, 5).map(day => day.title) };
    const stats: ShareVisual = { kind: 'stats', kicker: 'LE VOYAGE EN CHIFFRES', title: this.source.trip.country, subtitle: 'Des souvenirs qui restent', details: this.statsDetails() };
    const rec: ShareVisual = { kind: 'recommendation', kicker: 'À RECOMMANDER', title: recommendation?.name || 'Mon adresse coup de cœur', subtitle: recommendation?.city || this.source.trip.country, photo: photos[2]?.url || photos[0]?.url, details: recommendation?.comment ? [recommendation.comment] : [] };
    const cta: ShareVisual = { kind: 'cta', kicker: 'LA SUITE DU VOYAGE', title: 'Lire le carnet complet', subtitle: this.source.publicUrl ? this.shortUrl(this.source.publicUrl) : 'À retrouver dans To Get There', photo: photos[3]?.url || photos[0]?.url };

    if (this.destination === 'card') {
      const day = this.selectedDay;
      this.visuals = [{ kind: 'day', kicker: `JOUR ${String(day?.number || 1).padStart(2, '0')} · ${this.formatDate(day?.date)}`, title: day?.title || this.title, subtitle: day?.summary || this.subtitle, photo: photos[0]?.url, details: this.dayPlaces(day) }];
    } else if (this.destination === 'story') {
      this.visuals = [cover, memory, route, stats, rec, cta].slice(0, this.source.publicUrl ? 6 : 5);
    } else if (this.destination === 'carousel') {
      const daySlides = this.source.days.slice(0, 6).map((day, index): ShareVisual => ({ kind: 'day', kicker: `JOUR ${String(day.number).padStart(2, '0')}`, title: day.title || `Jour ${day.number}`, subtitle: day.summary || day.date, photo: this.photos.find(item => item.trip_day_id === day.id)?.url || photos[index % Math.max(photos.length, 1)]?.url }));
      this.visuals = [cover, ...daySlides, rec, stats, cta].slice(0, 10);
      while (this.visuals.length < 5) this.visuals.splice(this.visuals.length - 1, 0, memory);
    } else {
      this.visuals = [cover, memory, route, rec, stats, cta];
    }
    this.previewIndex = Math.min(this.previewIndex, Math.max(0, this.visuals.length - 1));
  }

  private async exportVideo(share: boolean) {
    this.error = '';
    if (!this.videoRenderer.supported) { this.error = 'L’export MP4 nécessite une version récente de Chrome ou Edge.'; return; }
    this.busy = true;
    try {
      if (!this.videoBlob) {
        const result = await this.videoRenderer.render(this.videoProject(), this.source.media, value => this.progress = value);
        this.videoBlob = result.blob;
        if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
        this.videoUrl = URL.createObjectURL(result.blob);
      }
      const file = new File([this.videoBlob], `${this.slug(this.title)}-${this.destination}.mp4`, { type: 'video/mp4' });
      if (share && await this.nativeShare([file])) return;
      this.downloadBlob(this.videoBlob, file.name);
      this.notice.emit('Vidéo prête et téléchargée');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.error = error instanceof Error ? error.message : 'L’export vidéo a échoué.';
    } finally { this.busy = false; }
  }

  private videoProject() {
    const photos = this.selectedPhotos.slice(0, Math.max(3, Math.min(10, Math.floor(this.duration / 3))));
    const intro = 2, outro = 2;
    const memoryDuration = (this.duration - intro - outro) / Math.max(photos.length, 1);
    const dayFor = (item: any) => this.source.days.find(day => day.id === item.trip_day_id);
    const memories = photos.length
      ? photos.map((item, index) => ({ scene_type: 'memory', duration: memoryDuration, title: dayFor(item)?.title || `Souvenir ${index + 1}`, caption: item.caption || dayFor(item)?.summary || this.source.trip.country, media_ids: [item.id] }))
      : [{ scene_type: 'memory', duration: this.duration - intro - outro, title: this.source.trip.country, caption: this.subtitle, media_ids: [] as string[] }];
    return {
      title: this.title,
      format: 'vertical',
      target_duration: this.duration,
      style_settings: { palette: this.palette, music: 'none', showText: this.showText, style: 'scrapbook' },
      scenes: [
        { scene_type: 'intro', duration: intro, title: this.title, caption: this.subtitle, media_ids: photos[0] ? [photos[0].id] : [] },
        ...memories,
        { scene_type: 'outro', duration: outro, title: 'Lire le carnet complet', caption: this.source.publicUrl ? this.shortUrl(this.source.publicUrl) : this.source.trip.title, media_ids: photos.at(-1) ? [photos.at(-1)!.id] : [] }
      ]
    };
  }

  private async exportImages(share: boolean) {
    this.error = ''; this.busy = true;
    try {
      const files: File[] = [];
      for (let index = 0; index < this.visuals.length; index++) {
        this.progress = { status: 'rendering', progress: Math.round(((index + 1) / this.visuals.length) * 100), label: `Création de la page ${index + 1}/${this.visuals.length}` };
        const blob = await this.renderVisual(this.visuals[index]);
        files.push(new File([blob], `${this.slug(this.title)}-${this.destination}-${String(index + 1).padStart(2, '0')}.png`, { type: 'image/png' }));
      }
      if (share && await this.nativeShare(files)) return;
      files.forEach((file, index) => setTimeout(() => this.downloadBlob(file, file.name), index * 180));
      this.notice.emit(`${files.length} visuel${files.length > 1 ? 's' : ''} prêt${files.length > 1 ? 's' : ''}`);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.error = error instanceof Error ? error.message : 'La création des visuels a échoué.';
    } finally { this.busy = false; }
  }

  private async nativeShare(files: File[]) {
    if (!navigator.share || !navigator.canShare || !navigator.canShare({ files })) return false;
    await navigator.share({ title: this.title, text: this.caption, url: this.source.publicUrl, files });
    return true;
  }

  private async renderVisual(visual: ShareVisual): Promise<Blob> {
    const portrait = this.destination !== 'carousel' && this.destination !== 'card';
    const width = 1080, height = portrait ? 1920 : 1350;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Impossible de créer le visuel.');
    const palette = PALETTES[this.palette];
    ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height);
    if (visual.photo) {
      try {
        const image = await this.loadImage(visual.photo); this.drawCover(ctx, image, width, height);
        const gradient = ctx.createLinearGradient(0, height * .2, 0, height); gradient.addColorStop(0, 'rgba(28,18,34,.08)'); gradient.addColorStop(1, 'rgba(28,18,34,.9)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); image.close();
      } catch { this.drawPaper(ctx, width, height, palette); }
    } else this.drawPaper(ctx, width, height, palette);

    const lightText = !!visual.photo || this.palette === 'nocturne';
    const ink = lightText ? '#fff' : palette.ink;
    const left = 86, maxWidth = width - left * 2;
    ctx.save(); ctx.translate(width * .5, 55); ctx.rotate(-.035); ctx.globalAlpha = .82; ctx.fillStyle = palette.pop; ctx.fillRect(-110, 0, 220, 34); ctx.restore();
    ctx.fillStyle = palette.accent; ctx.font = '900 27px Arial'; ctx.letterSpacing = '5px'; ctx.fillText(visual.kicker || 'SOUVENIR DE VOYAGE', left, height * .61);
    ctx.letterSpacing = '0px'; ctx.fillStyle = ink; ctx.font = `900 ${portrait ? 86 : 72}px Arial`;
    let y = height * .67; this.wrap(ctx, visual.title, maxWidth, 3).forEach(line => { ctx.fillText(line, left, y); y += portrait ? 94 : 79; });
    ctx.font = `600 ${portrait ? 38 : 32}px Arial`; ctx.globalAlpha = .94; y += 18;
    this.wrap(ctx, visual.subtitle, maxWidth, 4).forEach(line => { ctx.fillText(line, left, y); y += portrait ? 53 : 45; });
    if (visual.details?.length) {
      y += 36; ctx.font = `800 ${portrait ? 32 : 27}px Arial`; ctx.fillStyle = visual.photo ? '#fff' : palette.ink;
      visual.details.slice(0, 6).forEach((detail, index) => { ctx.fillStyle = index % 2 ? palette.soft : palette.pop; ctx.fillRect(left, y - 33, 32, 32); ctx.fillStyle = visual.photo ? '#fff' : palette.ink; ctx.fillText(detail, left + 52, y - 5); y += portrait ? 56 : 48; });
    }
    ctx.globalAlpha = 1; ctx.fillStyle = palette.pop; ctx.beginPath(); ctx.arc(width - 84, height - 82, 31, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lightText ? '#fff' : palette.ink; ctx.font = '900 21px Arial'; ctx.textAlign = 'right'; ctx.fillText(this.source.author ? `Carnet de ${this.source.author}` : 'Carnet de voyage', width - 135, height - 73);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Le visuel est resté vide.')), 'image/png'));
  }

  private drawPaper(ctx: CanvasRenderingContext2D, width: number, height: number, palette: typeof PALETTES[SharePalette]) {
    ctx.fillStyle = palette.soft; ctx.beginPath(); ctx.arc(width * .82, height * .2, width * .28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.pop; ctx.beginPath(); ctx.arc(width * .1, height * .82, width * .22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `${palette.accent}66`; ctx.lineWidth = 3;
    for (let y = 0; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  }
  private async loadImage(url: string) { const response = await fetch(url); if (!response.ok) throw new Error('Photo inaccessible'); return createImageBitmap(await response.blob()); }
  private drawCover(ctx: CanvasRenderingContext2D, image: ImageBitmap, width: number, height: number) { const ratio = Math.max(width / image.width, height / image.height); const w = image.width * ratio, h = image.height * ratio; ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h); }
  private wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) { const words = String(text || '').split(/\s+/).filter(Boolean), lines: string[] = []; let line = ''; for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; if (lines.length === maxLines - 1) break; } else line = candidate; } if (line && lines.length < maxLines) lines.push(line); return lines; }
  private downloadBlob(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
  private resetVideo() { this.videoBlob = null; this.progress = null; if (this.videoUrl) URL.revokeObjectURL(this.videoUrl); this.videoUrl = ''; }
  private slug(value: string) { return String(value || 'souvenir').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'souvenir'; }
  private formatDate(value?: string) { if (!value) return ''; return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
  private shortUrl(value: string) { try { const url = new URL(value); return `${url.host}${url.pathname}`; } catch { return value; } }
  private dayPlaces(day: any) { return [...new Set((day?.events ?? []).map((event: any) => event.place).filter(Boolean))].slice(0, 3) as string[]; }
  private itinerary() { const cities = (this.source.places ?? []).map((item: any) => item?.places?.city || item?.city).filter(Boolean); return [...new Set(cities)].slice(0, 6) as string[]; }
  private recommendation() { const item = (this.source.places ?? []).find((place: any) => place.recommended); return item?.places ? { ...item.places, ...item, comment: item.public_comment || item.comment } : item; }
  private statsDetails() { const stats = this.source.stats || {}; return [`${stats.days || this.source.days.length || 1} jours`, `${stats.cities || this.itinerary().length || '—'} villes`, `${stats.places || this.source.places?.length || '—'} lieux`, `${stats.photos || this.photos.length || '—'} photos`]; }
}

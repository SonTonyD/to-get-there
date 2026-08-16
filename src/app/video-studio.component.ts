import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface VideoStudioConfig {
  format: 'vertical' | 'horizontal';
  targetDuration: 30 | 60;
  palette: 'candy' | 'sunset' | 'ocean' | 'forest' | 'nocturne';
  music: 'none' | 'postcard' | 'roadtrip' | 'daydream';
  showText: boolean;
}

@Component({
  selector: 'app-video-studio', standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './video-studio.component.html',
  styleUrl: './video-studio.component.css'
})
export class VideoStudioComponent implements OnChanges, OnDestroy {
  @Input() trip: any;
  @Input() day: any;
  @Input() project: any;
  @Input() media: any[] = [];
  @Input() busy = '';
  @Input() render: any;
  @Input() error = '';
  @Output() close = new EventEmitter<void>();
  @Output() generate = new EventEmitter<VideoStudioConfig>();
  @Output() save = new EventEmitter<any>();
  @Output() exportFilm = new EventEmitter<any>();

  config: VideoStudioConfig = { format: 'vertical', targetDuration: 30, palette: 'candy', music: 'none', showText: true };
  selectedScene = 0;
  playing = false;
  dirty = false;
  mediaPicker = false;
  private playTimer?: ReturnType<typeof setTimeout>;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['project'] && this.project) {
      const style = this.project.style_settings ?? {};
      this.config = {
        format: this.project.format ?? 'vertical', targetDuration: Number(this.project.target_duration) === 60 ? 60 : 30,
        palette: style.palette ?? 'candy', music: style.music ?? 'none', showText: style.showText !== false
      };
      this.selectedScene = Math.min(this.selectedScene, Math.max(0, this.scenes.length - 1));
      this.dirty = false;
    }
  }
  ngOnDestroy() { clearTimeout(this.playTimer); }

  get scenes() { return this.project?.scenes ?? []; }
  get scene() { return this.scenes[this.selectedScene] ?? null; }
  get photos() { return this.media.filter(item => item.media_type === 'photo' && item.url); }
  get totalDuration() { return Math.round(this.scenes.reduce((sum: number, scene: any) => sum + Number(scene.duration || 0), 0) * 10) / 10; }
  get sourceLabel() { return this.day ? `${this.day.label} · ${this.day.date}` : `Tout le voyage · ${this.trip?.title ?? ''}`; }
  get renderLabel() {
    const labels: Record<string, string> = { queued: 'Dans la file de rendu', preparing: 'Préparation des médias', rendering: 'Création du film', uploading: 'Envoi du MP4', completed: 'Film prêt', failed: 'Rendu interrompu' };
    return labels[this.render?.status] ?? '';
  }

  sceneMedia(scene = this.scene) {
    const ids = scene?.media_ids ?? [];
    return ids.map((id: string) => this.media.find(item => item.id === id)).filter(Boolean);
  }
  firstSceneMedia(scene = this.scene) { return this.sceneMedia(scene)[0] ?? null; }
  selectScene(index: number) { this.selectedScene = index; this.mediaPicker = false; }
  configure(key: keyof VideoStudioConfig, value: any) {
    (this.config as any)[key] = value;
    if (this.project) {
      this.project.format = this.config.format;
      this.project.target_duration = this.config.targetDuration;
      this.project.style_settings = { ...(this.project.style_settings ?? {}), palette: this.config.palette, music: this.config.music, showText: this.config.showText, style: 'scrapbook' };
      this.markDirty();
    }
  }
  markDirty() { this.dirty = true; }
  move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= this.scenes.length) return;
    [this.scenes[index], this.scenes[next]] = [this.scenes[next], this.scenes[index]];
    this.scenes.forEach((scene: any, position: number) => scene.position = position);
    this.selectedScene = next; this.markDirty();
  }
  remove(index: number) {
    if (this.scenes.length <= 2) return;
    this.scenes.splice(index, 1);
    this.scenes.forEach((scene: any, position: number) => scene.position = position);
    this.selectedScene = Math.min(index, this.scenes.length - 1); this.markDirty();
  }
  addScene() {
    this.scenes.splice(this.selectedScene + 1, 0, { position: this.selectedScene + 1, scene_type: 'memory', duration: 3, title: 'Nouveau souvenir', caption: '', media_ids: [], settings: { transition: 'fade' } });
    this.scenes.forEach((scene: any, position: number) => scene.position = position);
    this.selectedScene++; this.markDirty();
  }
  toggleMedia(item: any) {
    const ids = this.scene.media_ids ?? (this.scene.media_ids = []);
    const index = ids.indexOf(item.id);
    if (index >= 0) ids.splice(index, 1); else if (ids.length < 3) ids.push(item.id);
    this.markDirty();
  }
  hasMedia(item: any) { return this.scene?.media_ids?.includes(item.id); }
  saveNow() { this.save.emit(this.project); }
  startExport() { this.exportFilm.emit(this.project); }

  togglePreview() {
    this.playing = !this.playing; clearTimeout(this.playTimer);
    if (this.playing) this.advancePreview();
  }
  private advancePreview() {
    if (!this.playing || !this.scenes.length) return;
    const duration = Math.max(1, Number(this.scene?.duration ?? 3)) * 1000;
    this.playTimer = setTimeout(() => {
      if (this.selectedScene >= this.scenes.length - 1) { this.selectedScene = 0; this.playing = false; return; }
      this.selectedScene++; this.advancePreview();
    }, duration);
  }
}

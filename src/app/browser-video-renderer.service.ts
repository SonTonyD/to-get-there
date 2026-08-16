import { Injectable } from '@angular/core';

export interface BrowserVideoProgress {
  status: 'checking' | 'preparing' | 'rendering' | 'audio' | 'finalizing' | 'completed' | 'failed';
  progress: number;
  label: string;
}

export interface BrowserVideoResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  duration: number;
}

type Palette = { accent: string; paper: string; ink: string; soft: string };

@Injectable({ providedIn: 'root' })
export class BrowserVideoRendererService {
  readonly fps = 25;
  private readonly palettes: Record<string, Palette> = {
    candy: { accent: '#ff62b0', paper: '#fff4df', ink: '#4f365c', soft: '#b8f2e6' },
    sunset: { accent: '#f49b52', paper: '#fff0df', ink: '#63372c', soft: '#ffd166' },
    ocean: { accent: '#38bdf8', paper: '#eafaff', ink: '#164e63', soft: '#a7f3d0' },
    forest: { accent: '#90a955', paper: '#f2f7e8', ink: '#344e41', soft: '#dce8c8' },
    nocturne: { accent: '#ff70a6', paper: '#251b2e', ink: '#fff1ff', soft: '#764ba2' }
  };

  get supported() {
    return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
  }

  async render(project: any, media: any[], report: (progress: BrowserVideoProgress) => void): Promise<BrowserVideoResult> {
    report({ status: 'checking', progress: 2, label: 'Vérification de ton appareil' });
    if (!this.supported) throw new Error('Ton navigateur ne permet pas encore l’export vidéo local. Essaie avec une version récente de Chrome ou Edge.');

    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } = await import('mediabunny');
    const vertical = project.format !== 'horizontal';
    const width = vertical ? 720 : 1280;
    const height = vertical ? 1280 : 720;
    const format = new Mp4OutputFormat();
    const quality = new Quality({ bitrate: vertical ? 3_800_000 : 4_200_000 });
    const preferredCodecs = ['avc', 'hevc', 'av1'].filter(codec => format.getSupportedVideoCodecs().includes(codec as any)) as any[];
    const videoCodec = await getFirstEncodableVideoCodec(preferredCodecs, { width, height, quality });
    if (!videoCodec) throw new Error('Aucun encodeur MP4 compatible n’est disponible sur cet appareil. Essaie Chrome ou Edge sur ordinateur.');

    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Impossible d’initialiser le moteur graphique.');
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality });
    output.addVideoTrack(videoSource, { frameRate: this.fps });

    const duration = Math.max(1, (project.scenes ?? []).reduce((sum: number, scene: any) => sum + Number(scene.duration || 0), 0));
    const musicEnabled = project.style_settings?.music && project.style_settings.music !== 'none';
    const audioCodec = musicEnabled ? await getFirstEncodableAudioCodec(
      ['aac'].filter(codec => format.getSupportedAudioCodecs().includes(codec as any)) as any[],
      { numberOfChannels: 2, sampleRate: 44_100, quality: new Quality({ bitrate: 128_000 }) }
    ) : null;
    const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: new Quality({ bitrate: 128_000 }) }) : null;
    if (audioSource) output.addAudioTrack(audioSource);

    report({ status: 'preparing', progress: 6, label: 'Préparation des photos' });
    const mediaById = new Map(media.map(item => [item.id, item]));
    const usedIds = [...new Set((project.scenes ?? []).flatMap((scene: any) => (scene.media_ids ?? []).slice(0, 2)))] as string[];
    const visuals = new Map<string, ImageBitmap>();
    for (let index = 0; index < usedIds.length; index++) {
      const item = mediaById.get(usedIds[index]);
      if (item?.url) {
        try { visuals.set(item.id, await this.loadVisual(item)); } catch { /* Une scène peut rester décorative si son média est illisible. */ }
      }
      report({ status: 'preparing', progress: 6 + Math.round(((index + 1) / Math.max(usedIds.length, 1)) * 9), label: `Préparation des souvenirs ${index + 1}/${usedIds.length}` });
    }

    await output.start();
    const scenes = project.scenes ?? [];
    const frameCount = Math.ceil(duration * this.fps);
    const palette = this.palettes[project.style_settings?.palette] ?? this.palettes['candy'];
    report({ status: 'rendering', progress: 16, label: 'Création des premières images' });
    for (let frame = 0; frame < frameCount; frame++) {
      const timestamp = frame / this.fps;
      const location = this.sceneAt(scenes, timestamp);
      this.drawFrame(context, width, height, location.scene, location.index, location.progress, palette, visuals, project.style_settings?.showText !== false);
      await videoSource.add(timestamp, 1 / this.fps, { keyFrame: frame % (this.fps * 2) === 0 });
      if (frame % 8 === 0 || frame === frameCount - 1) {
        const progress = 16 + Math.round(((frame + 1) / frameCount) * 72);
        report({ status: 'rendering', progress, label: `Montage en cours · scène ${location.index + 1}/${scenes.length}` });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    if (audioSource) {
      report({ status: 'audio', progress: 91, label: 'Ajout de l’ambiance musicale' });
      await audioSource.add(await this.createSoundtrack(duration, project.style_settings.music));
    }
    report({ status: 'finalizing', progress: 96, label: 'Assemblage du fichier MP4' });
    await output.finalize();
    visuals.forEach(bitmap => bitmap.close());
    if (!target.buffer) throw new Error('Le fichier vidéo est resté vide.');
    const title = String(project.title || 'film-souvenir').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    report({ status: 'completed', progress: 100, label: 'Film prêt' });
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), fileName: `${title || 'film-souvenir'}.mp4`, width, height, duration };
  }

  private sceneAt(scenes: any[], timestamp: number) {
    let cursor = 0;
    for (let index = 0; index < scenes.length; index++) {
      const duration = Math.max(1, Number(scenes[index].duration || 3));
      if (timestamp < cursor + duration || index === scenes.length - 1) return { scene: scenes[index], index, progress: Math.min(1, Math.max(0, (timestamp - cursor) / duration)) };
      cursor += duration;
    }
    return { scene: scenes[0] ?? {}, index: 0, progress: 0 };
  }

  private async loadVisual(item: any): Promise<ImageBitmap> {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error('Média inaccessible');
    const blob = await response.blob();
    if (item.media_type !== 'video') return createImageBitmap(blob);
    const url = URL.createObjectURL(blob); const video = document.createElement('video');
    try {
      video.muted = true; video.preload = 'auto'; video.src = url;
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Vidéo illisible')); });
      if (video.duration > .2) { video.currentTime = Math.min(.25, video.duration / 3); await new Promise<void>(resolve => { video.onseeked = () => resolve(); }); }
      return await createImageBitmap(video);
    } finally { URL.revokeObjectURL(url); }
  }

  private drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number, scene: any, index: number, progress: number, palette: Palette, visuals: Map<string, ImageBitmap>, showText: boolean) {
    ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height);
    const ids = scene?.media_ids ?? []; const main = visuals.get(ids[0]); const secondary = visuals.get(ids[1]);
    if (main) {
      const zoom = 1.035 + progress * .055; this.drawCover(ctx, main, width, height, zoom);
      const shade = ctx.createLinearGradient(0, height * .3, 0, height); shade.addColorStop(0, 'rgba(25,15,30,0)'); shade.addColorStop(1, 'rgba(25,15,30,.88)'); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = palette.soft; ctx.beginPath(); ctx.arc(width * .82, height * .16, width * .27, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = palette.accent; ctx.font = `900 ${Math.round(width * .18)}px serif`; ctx.textAlign = 'center'; ctx.fillText('✦', width / 2, height * .46);
    }
    if (secondary) {
      const cardWidth = width * .31, cardHeight = height * .22; const x = width * .62, y = height * .09;
      ctx.save(); ctx.translate(x + cardWidth / 2, y + cardHeight / 2); ctx.rotate((index % 2 ? -1 : 1) * .055); ctx.fillStyle = '#fff'; ctx.shadowColor = '#0005'; ctx.shadowBlur = 20; ctx.fillRect(-cardWidth / 2 - 9, -cardHeight / 2 - 9, cardWidth + 18, cardHeight + 35); ctx.shadowBlur = 0; ctx.beginPath(); ctx.rect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight); ctx.clip(); this.drawCover(ctx, secondary, cardWidth, cardHeight, 1, -cardWidth / 2, -cardHeight / 2); ctx.restore();
    }
    ctx.save(); ctx.translate(width * .5, height * .035); ctx.rotate(-.035); ctx.globalAlpha = .8; ctx.fillStyle = palette.accent; ctx.fillRect(-width * .09, 0, width * .18, height * .022); ctx.restore();
    if (showText) {
      const centered = ['intro', 'outro'].includes(scene?.scene_type); const left = centered ? width * .1 : width * .075; const maxWidth = centered ? width * .8 : width * .84;
      ctx.textAlign = centered ? 'center' : 'left'; const textX = centered ? width / 2 : left; const baseY = centered ? height * .58 : height * .73;
      ctx.fillStyle = palette.accent; ctx.font = `900 ${Math.round(width * .025)}px Arial`; ctx.fillText(scene?.scene_type === 'intro' ? 'CARNET EN MOUVEMENT' : `SOUVENIR ${String(index + 1).padStart(2, '0')}`, textX, baseY);
      ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(width * (centered ? .085 : .068))}px Arial`; const titleLines = this.wrap(ctx, scene?.title || 'Un souvenir à raconter', maxWidth, 2); let y = baseY + height * .055; const titleHeight = width * (centered ? .094 : .078); titleLines.forEach(line => { ctx.fillText(line, textX, y); y += titleHeight; });
      if (scene?.caption) { ctx.font = `600 ${Math.round(width * .032)}px Arial`; ctx.fillStyle = '#fff'; y += height * .012; this.wrap(ctx, scene.caption, maxWidth, 3).forEach(line => { ctx.fillText(line, textX, y); y += width * .043; }); }
    }
    const fade = Math.max(0, .14 - progress) / .14 + Math.max(0, progress - .86) / .14; if (fade > 0) { ctx.fillStyle = `rgba(25,15,30,${Math.min(.85, fade * .85)})`; ctx.fillRect(0, 0, width, height); }
    ctx.restore();
  }

  private drawCover(ctx: CanvasRenderingContext2D, image: ImageBitmap, width: number, height: number, scale = 1, x = 0, y = 0) {
    const ratio = Math.max(width / image.width, height / image.height) * scale; const drawnWidth = image.width * ratio, drawnHeight = image.height * ratio;
    ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  }
  private wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
    const words = String(text).split(/\s+/); const lines: string[] = []; let line = '';
    for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; if (lines.length === maxLines - 1) break; } else line = candidate; }
    if (line && lines.length < maxLines) lines.push(line); if (lines.join(' ').length < text.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:]?$/, '…'); return lines;
  }

  private async createSoundtrack(duration: number, mood: string): Promise<AudioBuffer> {
    const sampleRate = 44_100; const audio = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate); const master = audio.createGain(); master.gain.value = .11; master.connect(audio.destination);
    const moods: Record<string, number[]> = { postcard: [261.63, 329.63, 392, 523.25], roadtrip: [220, 277.18, 329.63, 440], daydream: [196, 246.94, 293.66, 392] }; const notes = moods[mood] ?? moods['daydream'];
    for (let start = 0, step = 0; start < duration; start += 4, step++) {
      for (const offset of [0, 2]) { const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.type = mood === 'roadtrip' ? 'triangle' : 'sine'; oscillator.frequency.value = notes[(step + offset) % notes.length]; gain.gain.setValueAtTime(0, start + offset); gain.gain.linearRampToValueAtTime(mood === 'roadtrip' ? .18 : .12, start + offset + .35); gain.gain.exponentialRampToValueAtTime(.001, Math.min(duration, start + offset + 3.5)); oscillator.connect(gain); gain.connect(master); oscillator.start(start + offset); oscillator.stop(Math.min(duration, start + offset + 3.6)); }
    }
    return audio.startRendering();
  }
}

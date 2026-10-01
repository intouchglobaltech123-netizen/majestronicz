/**
 * Small, tasteful UI sound cues, synthesized with the Web Audio API — no audio
 * files to ship, license or cache, and nothing that sounds like a harsh system
 * "beep". Each cue is a few soft sine tones with a gentle attack and a smooth
 * exponential release, kept at a low volume so it reads as "premium / calm",
 * never irritating.
 *
 * Browsers block audio until the first user gesture; the context is created
 * lazily on first play and resumed if suspended, and every call is wrapped so a
 * blocked or unsupported context simply plays nothing.
 */

import { readScoped, writeScoped } from './userPrefs';

const MUTE_KEY = 'majestronicz_sound_muted';

/** Sound is ON by default (the client asked for it); muted is opt-out, per user. */
export function isSoundMuted(): boolean {
  return readScoped(MUTE_KEY) === 'true';
}

export function setSoundMuted(muted: boolean): void {
  writeScoped(MUTE_KEY, String(muted));
}

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  /** seconds from the cue start */
  start: number;
  /** seconds */
  duration: number;
  /** peak gain 0..1 */
  gain?: number;
  type?: OscillatorType;
}

function playTones(tones: Tone[]): void {
  if (isSoundMuted()) return;
  const ac = audioCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.02;
    // A shared soft low-pass takes the edge off the highest harmonics so the
    // cue sounds rounded (like a bell/marimba), not piercing.
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    const master = ac.createGain();
    master.gain.value = 0.9;
    filter.connect(master);
    master.connect(ac.destination);

    for (const tone of tones) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = tone.type || 'sine';
      osc.frequency.value = tone.freq;
      const peak = tone.gain ?? 0.12;
      const start = t0 + tone.start;
      const end = start + tone.duration;
      // Gentle 12ms attack, then a smooth exponential release — no clicks.
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g);
      g.connect(filter);
      osc.start(start);
      osc.stop(end + 0.03);
    }
  } catch {
    /* audio unavailable — stay silent */
  }
}

/**
 * A calm two-note "ding–dong" for a new notification / alert. A soft perfect
 * fourth (A5 → E6) on sine waves — professional and unobtrusive.
 */
export function playNotify(): void {
  playTones([
    { freq: 880.0, start: 0.0, duration: 0.28, gain: 0.11 },
    { freq: 1318.5, start: 0.14, duration: 0.5, gain: 0.1 },
  ]);
}

/**
 * A bright, pleasant ascending major triad (C6–E6–G6) for a completed action
 * such as an attendance check-in / check-out — a small "well done" flourish.
 */
export function playSuccess(): void {
  playTones([
    { freq: 1046.5, start: 0.0, duration: 0.26, gain: 0.1 },
    { freq: 1318.5, start: 0.1, duration: 0.26, gain: 0.1 },
    { freq: 1568.0, start: 0.2, duration: 0.5, gain: 0.11 },
  ]);
}

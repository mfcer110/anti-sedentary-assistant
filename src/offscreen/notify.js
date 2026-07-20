/**
 * Offscreen：按需播放提示音
 *
 * payload:
 *  - kind: 'soft' | 'break' | 'urgent'
 *  - volume: 0–100
 *  - style: 'default' | 'chime' | 'pulse' | 'bell' | 'custom'
 *
 * 自定义音频从 chrome.storage.local 的 customSound 键读取，避免消息体过大
 */

import { Actions, CUSTOM_SOUND_KEY } from '../shared/constants.js';

let audioCtx = null;
let activeHtmlAudio = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (self.AudioContext || self.webkitAudioContext)();
  }
  return audioCtx;
}

/** 0–100 → 峰值增益乘数 */
function volumeScale(volume = 80) {
  const v = Math.max(0, Math.min(100, Number(volume) || 0));
  return (v / 100) * 1.35;
}

function tone(ctx, { freq, start, duration, peak = 0.22, type = 'sine' }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(40, freq * 0.92),
    start + duration
  );

  const attack = Math.min(0.03, duration * 0.15);
  const safePeak = Math.max(0.0001, Math.min(0.55, peak));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(safePeak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration - 0.001);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playBuiltin(ctx, kind, style, vol) {
  const now = ctx.currentTime;
  const s = vol;

  if (kind === 'soft') {
    if (style === 'bell') {
      tone(ctx, { freq: 660, start: now, duration: 0.45, peak: 0.14 * s, type: 'sine' });
      tone(ctx, { freq: 990, start: now, duration: 0.35, peak: 0.06 * s, type: 'sine' });
    } else if (style === 'pulse') {
      tone(ctx, { freq: 180, start: now, duration: 0.18, peak: 0.2 * s, type: 'triangle' });
      tone(ctx, { freq: 180, start: now + 0.22, duration: 0.18, peak: 0.18 * s, type: 'triangle' });
    } else if (style === 'chime') {
      tone(ctx, { freq: 784, start: now, duration: 0.2, peak: 0.16 * s });
      tone(ctx, { freq: 1046, start: now + 0.12, duration: 0.28, peak: 0.14 * s });
    } else {
      tone(ctx, { freq: 320, start: now, duration: 0.22, peak: 0.16 * s });
    }
    return;
  }

  if (kind === 'break') {
    if (style === 'bell') {
      for (let i = 0; i < 2; i++) {
        const t = now + i * 0.42;
        tone(ctx, { freq: 523, start: t, duration: 0.5, peak: 0.22 * s, type: 'sine' });
        tone(ctx, { freq: 784, start: t, duration: 0.4, peak: 0.1 * s, type: 'sine' });
      }
      return;
    }
    if (style === 'pulse') {
      for (let i = 0; i < 3; i++) {
        tone(ctx, {
          freq: 200,
          start: now + i * 0.28,
          duration: 0.2,
          peak: 0.28 * s,
          type: 'triangle',
        });
      }
      return;
    }
    if (style === 'chime') {
      const notes = [523, 659, 784];
      notes.forEach((f, i) => {
        tone(ctx, { freq: f, start: now + i * 0.16, duration: 0.35, peak: 0.22 * s });
      });
      return;
    }
    tone(ctx, { freq: 392, start: now, duration: 0.18, peak: 0.22 * s });
    tone(ctx, { freq: 523, start: now + 0.2, duration: 0.28, peak: 0.26 * s });
    return;
  }

  // urgent
  if (style === 'bell') {
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.55;
      tone(ctx, { freq: 587, start: t, duration: 0.45, peak: 0.3 * s, type: 'sine' });
      tone(ctx, { freq: 880, start: t + 0.05, duration: 0.35, peak: 0.14 * s, type: 'sine' });
    }
    return;
  }
  if (style === 'pulse') {
    for (let i = 0; i < 6; i++) {
      tone(ctx, {
        freq: 160 + (i % 2) * 40,
        start: now + i * 0.22,
        duration: 0.16,
        peak: 0.34 * s,
        type: 'square',
      });
    }
    return;
  }
  if (style === 'chime') {
    const pattern = [523, 659, 784, 1046, 784, 659];
    pattern.forEach((f, i) => {
      tone(ctx, {
        freq: f,
        start: now + i * 0.18,
        duration: 0.28,
        peak: 0.28 * s,
      });
    });
    return;
  }
  const pattern = [
    { t: 0.0, f: 440 },
    { t: 0.16, f: 554 },
    { t: 0.55, f: 440 },
    { t: 0.71, f: 554 },
    { t: 1.1, f: 440 },
    { t: 1.26, f: 659 },
  ];
  for (const p of pattern) {
    tone(ctx, {
      freq: p.f,
      start: now + p.t,
      duration: 0.2,
      peak: 0.32 * s,
      type: 'triangle',
    });
  }
}

function stopHtmlAudio() {
  if (activeHtmlAudio) {
    try {
      activeHtmlAudio.pause();
      activeHtmlAudio.src = '';
    } catch (_) {}
    activeHtmlAudio = null;
  }
}

async function loadCustomDataUrl() {
  try {
    const data = await chrome.storage.local.get(CUSTOM_SOUND_KEY);
    return data[CUSTOM_SOUND_KEY]?.dataUrl || null;
  } catch (_) {
    return null;
  }
}

/**
 * 播放自定义文件；urgent / break 会连播多次
 */
async function playCustom(dataUrl, kind, volume) {
  stopHtmlAudio();
  const vol = Math.max(0, Math.min(1, (Number(volume) || 80) / 100));
  const times = kind === 'urgent' ? 3 : kind === 'break' ? 2 : 1;
  const gapMs = kind === 'urgent' ? 280 : 200;

  for (let i = 0; i < times; i++) {
    await new Promise((resolve, reject) => {
      const audio = new Audio(dataUrl);
      activeHtmlAudio = audio;
      audio.volume = vol;
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      audio.onended = () => done();
      audio.onerror = () => done(new Error('custom audio play failed'));
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch((e) => done(e));
      }
      setTimeout(() => done(), 8000);
    });
    if (i < times - 1) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}

async function playAlert(payload = {}) {
  const kind = payload.kind || 'break';
  const volume = payload.volume ?? 80;
  let style = payload.style || 'default';

  if (style === 'custom') {
    const dataUrl = await loadCustomDataUrl();
    if (dataUrl) {
      await playCustom(dataUrl, kind, volume);
      return;
    }
    // 无自定义文件时回退默认
    style = 'default';
  }

  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (_) {}
  }
  playBuiltin(ctx, kind, style, volumeScale(volume));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== Actions.PLAY_NOTIFY) return;
  playAlert(message.payload || {})
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

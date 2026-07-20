/**
 * Storage 封装：内存镜像 + 批量节流写入
 * 降低 chrome.storage 硬盘 IO
 */

import {
  DEFAULT_SETTINGS,
  SIT_PHASE,
  STORAGE_FLUSH_MS,
  minutesToSeconds,
  todayKey,
  CUSTOM_SOUND_KEY,
} from '../shared/constants.js';
import { deepClone } from '../shared/utils.js';

const KEYS = {
  SETTINGS: 'settings',
  STATE: 'state',
  COOLDOWN: 'cooldown',
  CUSTOM_SOUND: CUSTOM_SOUND_KEY,
};

/** 内存镜像 */
let settingsCache = null;
let stateCache = null;
let cooldownCache = null;

let dirty = false;
let flushTimer = null;
let readyPromise = null;

function createDefaultState(settings = DEFAULT_SETTINGS) {
  return {
    sit: {
      phase: SIT_PHASE.FOCUSING,
      remainSeconds: minutesToSeconds(settings.workDuration),
      totalSeconds: minutesToSeconds(settings.workDuration),
      isPaused: false,
      pendingSince: null, // BREAK_PENDING 进入时间戳（秒）
    },
    kegel: {
      nextTrigger: 0, // 时间戳 ms
      mutedByFullscreen: false,
    },
    dailyStats: {
      date: todayKey(),
      kegelCount: 0,
      breakCount: 0,
      focusMinutes: 0,
    },
    meta: {
      lastTickAt: Date.now(),
      userIdle: false,
      fullscreen: false,
    },
  };
}

function createDefaultCooldown() {
  return {
    lastStrongAlert: 0,
    lastSitNotify: 0,
    lastKegelNotify: 0,
  };
}

/** 跨日重置统计 */
function ensureDailyStats(state) {
  const today = todayKey();
  if (!state.dailyStats || state.dailyStats.date !== today) {
    state.dailyStats = {
      date: today,
      kegelCount: 0,
      breakCount: 0,
      focusMinutes: 0,
    };
  }
  return state;
}

async function loadAll() {
  const data = await chrome.storage.local.get([
    KEYS.SETTINGS,
    KEYS.STATE,
    KEYS.COOLDOWN,
  ]);

  settingsCache = { ...DEFAULT_SETTINGS, ...(data[KEYS.SETTINGS] || {}) };
  stateCache = ensureDailyStats(
    data[KEYS.STATE] ? deepClone(data[KEYS.STATE]) : createDefaultState(settingsCache)
  );
  // 补全可能缺失的字段
  stateCache = {
    ...createDefaultState(settingsCache),
    ...stateCache,
    sit: { ...createDefaultState(settingsCache).sit, ...(stateCache.sit || {}) },
    kegel: { ...createDefaultState(settingsCache).kegel, ...(stateCache.kegel || {}) },
    dailyStats: stateCache.dailyStats,
    meta: { ...createDefaultState(settingsCache).meta, ...(stateCache.meta || {}) },
  };
  ensureDailyStats(stateCache);
  cooldownCache = { ...createDefaultCooldown(), ...(data[KEYS.COOLDOWN] || {}) };
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow().catch((err) => console.error('[storage] flush failed', err));
  }, STORAGE_FLUSH_MS);
}

export async function initStorage() {
  if (!readyPromise) {
    readyPromise = loadAll();
  }
  await readyPromise;
  return getSnapshot();
}

export function getSettings() {
  return deepClone(settingsCache);
}

export function getState() {
  return deepClone(stateCache);
}

export function getCooldown() {
  return deepClone(cooldownCache);
}

/** 对外只读快照 */
export function getSnapshot() {
  return {
    settings: getSettings(),
    state: getState(),
    cooldown: getCooldown(),
  };
}

/**
 * 更新 settings（合并）
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @param {{ immediate?: boolean }} opts
 */
export async function updateSettings(partial, opts = {}) {
  settingsCache = { ...settingsCache, ...partial };
  dirty = true;
  if (opts.immediate) {
    await flushNow();
  } else {
    scheduleFlush();
  }
  return getSettings();
}

/**
 * 用 mutator 修改 state
 * @param {(state: object) => void} mutator
 * @param {{ immediate?: boolean, reason?: string }} opts
 */
export async function updateState(mutator, opts = {}) {
  mutator(stateCache);
  ensureDailyStats(stateCache);
  dirty = true;
  // phase 变更或显式要求时立即落盘
  if (opts.immediate) {
    await flushNow();
  } else {
    scheduleFlush();
  }
  return getState();
}

export async function updateCooldown(partial, opts = {}) {
  cooldownCache = { ...cooldownCache, ...partial };
  dirty = true;
  if (opts.immediate) {
    await flushNow();
  } else {
    scheduleFlush();
  }
  return getCooldown();
}

/** 立即刷盘 */
export async function flushNow() {
  if (!dirty && settingsCache && stateCache && cooldownCache) {
    // 仍允许强制写入
  }
  if (!settingsCache || !stateCache || !cooldownCache) {
    await initStorage();
  }
  const payload = {
    [KEYS.SETTINGS]: settingsCache,
    [KEYS.STATE]: stateCache,
    [KEYS.COOLDOWN]: cooldownCache,
  };
  await chrome.storage.local.set(payload);
  dirty = false;
}

/** 重置久坐状态到专注起点 */
export async function resetSitToFocus(settings = settingsCache) {
  return updateState(
    (s) => {
      const total = minutesToSeconds(settings.workDuration);
      s.sit.phase = SIT_PHASE.FOCUSING;
      s.sit.remainSeconds = total;
      s.sit.totalSeconds = total;
      s.sit.isPaused = false;
      s.sit.pendingSince = null;
    },
    { immediate: true, reason: 'reset' }
  );
}

/** 重置全部状态（保留 settings） */
export async function hardResetState() {
  stateCache = createDefaultState(settingsCache);
  cooldownCache = createDefaultCooldown();
  dirty = true;
  await flushNow();
  return getSnapshot();
}

/** Popup 打开时建议立即刷盘，保证一致性 */
export async function flushForPopup() {
  await flushNow();
  return getSnapshot();
}

/**
 * 自定义提示音：{ dataUrl, name, mime, size } | null
 * 与 settings 分离存储，避免 STATE_UPDATED 广播膨胀
 */
export async function getCustomSound() {
  const data = await chrome.storage.local.get(KEYS.CUSTOM_SOUND);
  return data[KEYS.CUSTOM_SOUND] || null;
}

export async function setCustomSound(payload) {
  if (!payload?.dataUrl) {
    await chrome.storage.local.remove(KEYS.CUSTOM_SOUND);
    return null;
  }
  const record = {
    dataUrl: payload.dataUrl,
    name: payload.name || 'custom',
    mime: payload.mime || 'audio/mpeg',
    size: payload.size || 0,
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({ [KEYS.CUSTOM_SOUND]: record });
  return record;
}

export async function clearCustomSound() {
  await chrome.storage.local.remove(KEYS.CUSTOM_SOUND);
}

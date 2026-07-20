/**
 * Service Worker 主入口
 * - 注册 Alarms / 消息 / 安装生命周期
 * - 双核状态机调度
 * - Badge / 通知 / Offscreen / 页面横幅 按需触发
 */

import {
  Actions,
  ALARM,
  COPY,
  SIT_PHASE,
  STRONG_ALERT_COOLDOWN_SECONDS,
  OFFSCREEN_TTL_MS,
  WARN_BEFORE_SECONDS,
  CUSTOM_SOUND_MAX_BYTES,
  minutesToSeconds,
} from '../shared/constants.js';
import {
  initStorage,
  getSnapshot,
  getSettings,
  getState,
  updateSettings,
  updateState,
  updateCooldown,
  flushForPopup,
  flushNow,
  setCustomSound,
  clearCustomSound,
} from './storage.js';
import { sitTimer } from './state-machine/SitTimer.js';
import { kegelTimer } from './state-machine/KegelTimer.js';
import {
  ensureSitAlarm,
  scheduleKegelAt,
  ensureAllAlarms,
  scheduleOffscreenCleanup,
  clearKegelAlarm,
  rescheduleSitAlarmIfDebug,
  scheduleBadgeBlink,
  clearBadgeBlink,
  scheduleUrgentNudge,
  clearUrgentNudge,
} from './scheduler.js';

// ─── 初始化 ───────────────────────────────────────────

let bootPromise = null;
/** 角标闪烁开关态 */
let badgeBlinkOn = true;

/**
 * 按墙钟推进久坐计时（修复：打开 popup / SW 唤醒时时间被「重置」）
 * 旧逻辑在 boot 时直接 lastTickAt=now，会丢掉休眠期间已过时间；
 * popup 本地倒计时也不会回写，再次打开就像回到旧值。
 */
async function syncSitWithWallClock({ source = 'sync' } = {}) {
  const settings = getSettings();
  const now = Date.now();
  const events = [];
  let applied = 0;

  await updateState((s) => {
    const last = s.meta.lastTickAt || now;
    let delta = Math.floor((now - last) / 1000);

    // 时钟回拨或同秒：只校正锚点
    if (delta < 0) {
      s.meta.lastTickAt = now;
      return;
    }
    if (delta < 1) {
      return;
    }

    // 单次最多推进一轮专注/休息时长（或 1 小时），避免极端休眠一次跳空
    const maxDelta = Math.max(
      minutesToSeconds(settings.workDuration || 50),
      minutesToSeconds(settings.breakDuration || 10),
      3600
    );
    if (delta > maxDelta) delta = maxDelta;
    applied = delta;

    if (s.sit.phase === SIT_PHASE.FOCUSING && !s.sit.isPaused) {
      s.dailyStats.focusMinutes =
        (s.dailyStats.focusMinutes || 0) + delta / 60;
    }

    const result = sitTimer.tick(s.sit, delta, { settings });
    events.push(...result.events);
    s.meta.lastTickAt = now;
  }, { immediate: true });

  if (events.length) {
    await handleEvents(events);
    await flushNow();
  }

  if (applied > 0) {
    console.log(`[bg] wall-clock sync (${source}): -${applied}s`, getState().sit.phase, getState().sit.remainSeconds);
  }
  return events;
}

async function boot() {
  await initStorage();
  const { settings, state } = getSnapshot();

  // 若 kegel 下次触发无效，重算
  if (!state.kegel.nextTrigger || state.kegel.nextTrigger < Date.now()) {
    const next = kegelTimer.nextTriggerAt(settings.kegelInterval);
    await updateState((s) => {
      s.kegel.nextTrigger = next;
    }, { immediate: true });
  }

  // 按真实经过时间推进，而不是丢掉间隔
  await syncSitWithWallClock({ source: 'boot' });

  const snap = getSnapshot();
  await ensureAllAlarms(snap.state.kegel.nextTrigger);
  await refreshBadge(snap.state);

  // 恢复到 break 态时重新挂上闪烁 / 复响
  if (
    snap.state.sit.phase === SIT_PHASE.BREAK_PENDING ||
    snap.state.sit.phase === SIT_PHASE.BREAK_URGENT
  ) {
    await scheduleBadgeBlink();
  }
  if (snap.state.sit.phase === SIT_PHASE.BREAK_URGENT) {
    await scheduleUrgentNudge();
  }

  console.log('[bg] booted', snap.state.sit.phase, snap.state.sit.remainSeconds);
}

function ensureBoot() {
  if (!bootPromise) {
    bootPromise = boot().catch((e) => {
      console.error('[bg] boot failed', e);
      bootPromise = null;
    });
  }
  return bootPromise;
}

// ─── Badge ─────────────────────────────────────────────

function badgeForPhase(sit, { blinkOn = true } = {}) {
  let text = '';
  let color = '#3b82f6';

  if (sit.phase === SIT_PHASE.FOCUSING) {
    if (sit.remainSeconds <= WARN_BEFORE_SECONDS && sit.remainSeconds > 0) {
      text = '1m';
      color = '#f59e0b';
    } else {
      const mins = Math.ceil(sit.remainSeconds / 60);
      text = mins > 99 ? '99+' : String(mins);
      color = '#3b82f6';
    }
  } else if (sit.phase === SIT_PHASE.BREAK_PENDING) {
    // 闪烁：GO ↔ !!
    text = blinkOn ? 'GO' : '!!';
    color = blinkOn ? '#ef4444' : '#f97316';
  } else if (sit.phase === SIT_PHASE.BREAK_URGENT) {
    text = blinkOn ? '!!!' : 'UP';
    color = blinkOn ? '#dc2626' : '#7f1d1d';
  } else if (sit.phase === SIT_PHASE.RESTING) {
    text = 'Zzz';
    color = '#10b981';
  } else if (sit.phase === SIT_PHASE.PAUSED || sit.isPaused) {
    text = '||';
    color = '#94a3b8';
  }

  return { text, color };
}

async function refreshBadge(state, opts = {}) {
  const { text, color } = badgeForPhase(state.sit, opts);
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    // 部分 Chromium 支持文字色，失败则忽略
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
  } catch (_) {
    // badge 在某些环境可能失败，忽略
  }
}

/** 微动提醒时短暂显示圆点 */
async function flashKegelBadge() {
  try {
    await chrome.action.setBadgeText({ text: '•' });
    await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } catch (_) {}
}

async function onBadgeBlink() {
  const state = getState();
  const phase = state.sit.phase;
  if (phase !== SIT_PHASE.BREAK_PENDING && phase !== SIT_PHASE.BREAK_URGENT) {
    await clearBadgeBlink();
    await refreshBadge(state, { blinkOn: true });
    return;
  }
  badgeBlinkOn = !badgeBlinkOn;
  await refreshBadge(state, { blinkOn: badgeBlinkOn });
  await scheduleBadgeBlink();
}

// ─── Offscreen 音效 ────────────────────────────────────

async function hasOffscreenDoc() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreenDoc()) return;
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/index.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play private alert tones for break / overdue reminders',
  });
}

async function closeOffscreen() {
  try {
    if (await hasOffscreenDoc()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    console.warn('[bg] close offscreen', e);
  }
}

/**
 * @param {'soft' | 'break' | 'urgent'} kind
 * @param {{ force?: boolean, preview?: boolean }} opts
 */
async function playAlertTone(kind = 'break', opts = {}) {
  const { settings, cooldown } = getSnapshot();
  if (!settings.soundAlerts && !opts.preview) return;

  const now = Math.floor(Date.now() / 1000);
  // soft / preview 不走冷却；break/urgent 有短冷却防抖
  if (!opts.force && !opts.preview && kind !== 'soft') {
    if (now - (cooldown.lastStrongAlert || 0) < STRONG_ALERT_COOLDOWN_SECONDS) {
      return;
    }
  }

  try {
    const style = settings.soundStyle || 'default';
    const volume = settings.soundVolume ?? 80;
    // 自定义音频由 offscreen 自行从 storage 读取，避免大文件走消息通道
    const useCustom = style === 'custom' && !!settings.hasCustomSound;

    await ensureOffscreen();
    await new Promise((r) => setTimeout(r, 60));
    await chrome.runtime
      .sendMessage({
        action: Actions.PLAY_NOTIFY,
        payload: {
          kind,
          volume,
          style: useCustom ? 'custom' : style === 'custom' ? 'default' : style,
        },
      })
      .catch(() => {});
    if (!opts.preview && kind !== 'soft') {
      await updateCooldown({ lastStrongAlert: now }, { immediate: true });
    }
    const extra = kind === 'urgent' ? 2500 : useCustom ? 4000 : 0;
    await scheduleOffscreenCleanup(OFFSCREEN_TTL_MS + extra);
  } catch (e) {
    console.warn('[bg] alert tone failed', e);
  }
}

/** 紧急时让浏览器窗口在任务栏闪烁 / 抢焦点提示 */
async function flashBrowserWindow() {
  const settings = getSettings();
  if (settings.windowFlash === false) return;
  // 全屏静默时不闪（避免演示尴尬）
  const state = getState();
  if (state.meta?.fullscreen && settings.isFullscreenMute) return;

  try {
    if (!chrome.windows?.getLastFocused) return;
    const win = await chrome.windows.getLastFocused({
      populate: false,
    });
    if (!win?.id) return;
    // drawAttention：任务栏闪烁，不强制抢前台
    await chrome.windows.update(win.id, { drawAttention: true });
  } catch (e) {
    console.warn('[bg] window flash failed', e);
  }
}

// ─── 页面横幅（content script） ────────────────────────

async function broadcastToTabs(message) {
  try {
    // 不带 url 过滤，避免缺少 host/tabs 权限时查不到标签
    // 未注入 content script 的标签 sendMessage 会静默失败
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (tab.id == null) return Promise.resolve();
        return chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      })
    );
  } catch (_) {}
}

/**
 * 统一页面内卡片（替代系统通知）
 * @param {'warn'|'break'|'urgent'|'kegel'|'info'|'success'} level
 * @param {{ title: string, message: string }} copy
 * @param {{ actions?: string, autoHideMs?: number }} opts
 */
async function showPageBanner(level, copy, opts = {}) {
  const settings = getSettings();
  if (settings.pageBanner === false) return;
  await broadcastToTabs({
    action: Actions.SHOW_PAGE_BANNER,
    payload: {
      level,
      title: copy.title,
      message: copy.message,
      actions: opts.actions,
      autoHideMs: opts.autoHideMs,
    },
  });
}

async function hidePageBanner() {
  await broadcastToTabs({ action: Actions.HIDE_PAGE_BANNER });
}

// ─── 离开休息相关态时清理 ──────────────────────────────

async function clearBreakAttention() {
  await clearBadgeBlink();
  await clearUrgentNudge();
  await hidePageBanner();
  badgeBlinkOn = true;
}

// ─── 事件处理（状态机输出） ────────────────────────────

async function handleEvents(events) {
  for (const ev of events) {
    switch (ev) {
      case 'SIT_WARN':
        await playAlertTone('soft');
        await showPageBanner('warn', COPY.sitWarn, {
          actions: 'ok',
          autoHideMs: 12_000,
        });
        break;

      case 'SIT_BREAK_PENDING':
        await playAlertTone('break', { force: true });
        await flashBrowserWindow();
        await showPageBanner('break', COPY.sitBreak, { actions: 'break' });
        badgeBlinkOn = true;
        await scheduleBadgeBlink();
        break;

      case 'SIT_BREAK_URGENT':
        await playAlertTone('urgent', { force: true });
        await flashBrowserWindow();
        await showPageBanner('urgent', COPY.sitUrgent, { actions: 'break' });
        badgeBlinkOn = true;
        await scheduleBadgeBlink();
        await scheduleUrgentNudge();
        break;

      case 'SIT_REST_START':
        await clearBreakAttention();
        await updateState((s) => {
          s.dailyStats.breakCount = (s.dailyStats.breakCount || 0) + 1;
        });
        await showPageBanner('success', COPY.sitRestStart, {
          actions: 'ok',
          autoHideMs: 8_000,
        });
        break;

      case 'SIT_REST_DONE':
        await playAlertTone('soft');
        await showPageBanner('info', COPY.sitRestDone, {
          actions: 'ok',
          autoHideMs: 10_000,
        });
        break;

      case 'SIT_SKIP_BREAK':
        await clearBreakAttention();
        break;

      case 'KEGEL_REMIND':
        await playAlertTone('soft');
        await flashKegelBadge();
        await showPageBanner('kegel', COPY.kegel, {
          actions: 'kegel',
          autoHideMs: 20_000,
        });
        break;

      case 'KEGEL_DONE_MANUAL':
        await showPageBanner('success', COPY.kegelDone, {
          actions: 'ok',
          autoHideMs: 4_000,
        });
        break;

      default:
        break;
    }
  }
}

/** 紧急态周期复响 */
async function onUrgentNudge() {
  const state = getState();
  if (state.sit.phase !== SIT_PHASE.BREAK_URGENT) {
    await clearUrgentNudge();
    return;
  }
  await playAlertTone('urgent', { force: true });
  await flashBrowserWindow();
  await showPageBanner('urgent', COPY.sitUrgent, { actions: 'break' });
  await scheduleUrgentNudge();
}

// ─── 广播状态给 Popup（若打开） ────────────────────────

function broadcastState() {
  const snap = getSnapshot();
  chrome.runtime
    .sendMessage({
      action: Actions.STATE_UPDATED,
      payload: snap,
    })
    .catch(() => {
      // 无接收端属正常
    });
}

// ─── Sit 推进 ──────────────────────────────────────────

async function advanceSit() {
  await ensureBoot();
  // 与打开 popup 共用墙钟同步，避免 alarm 与 GET_STATE 两套算法不一致
  await syncSitWithWallClock({ source: 'alarm' });
  await refreshBadge(getState(), { blinkOn: badgeBlinkOn });
  broadcastState();
}

// ─── Kegel 触发 ────────────────────────────────────────

async function fireKegel() {
  await ensureBoot();
  const settings = getSettings();
  const events = [];
  let next = 0;

  await updateState((s) => {
    const result = kegelTimer.fire(s.kegel, settings);
    events.push(...result.events);
    next = result.nextTrigger;
  }, { immediate: true });

  await handleEvents(events);
  if (next) await scheduleKegelAt(next);
  broadcastState();
}

// ─── 开始休息（多入口共用） ────────────────────────────

async function doStartBreak() {
  const settings = getSettings();
  const events = [];
  // 切换相位前先结算旧阶段时间
  await syncSitWithWallClock({ source: 'start-break' });
  await updateState((s) => {
    const r = sitTimer.startBreak(s.sit, settings);
    events.push(...r.events);
    // 新倒计时从「现在」起算，避免把之前间隔扣到休息时长上
    s.meta.lastTickAt = Date.now();
  }, { immediate: true });
  await handleEvents(events);
  await refreshBadge(getState());
  broadcastState();
  return getSnapshot();
}

// ─── 消息处理 ──────────────────────────────────────────

async function onMessage(message, _sender) {
  await ensureBoot();
  const action = message?.action;
  if (!action) return { ok: false, error: 'no action' };

  switch (action) {
    case Actions.GET_STATE: {
      // 打开 popup 时先按墙钟校准，再返回，避免「一点击就回到旧时间」
      await syncSitWithWallClock({ source: 'popup' });
      await refreshBadge(getState(), { blinkOn: badgeBlinkOn });
      const snap = await flushForPopup();
      return { ok: true, payload: snap };
    }

    case Actions.UPDATE_SETTINGS: {
      const partial = message.payload || {};
      const settings = await updateSettings(partial, { immediate: true });
      if (
        partial.workDuration != null ||
        partial.breakDuration != null ||
        partial.kegelInterval != null ||
        partial.kegelEnabled != null
      ) {
        await updateState((s) => {
          if (partial.kegelInterval != null || partial.kegelEnabled != null) {
            s.kegel.nextTrigger = kegelTimer.nextTriggerAt(
              settings.kegelInterval
            );
          }
        }, { immediate: true });
        const st = getState();
        if (settings.kegelEnabled) {
          await scheduleKegelAt(st.kegel.nextTrigger);
        } else {
          await clearKegelAlarm();
        }
      }
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.PAUSE_SIT: {
      // 暂停前先结算已经过的时间，再冻结
      await syncSitWithWallClock({ source: 'pause' });
      await updateState((s) => {
        sitTimer.pause(s.sit);
        s.meta.lastTickAt = Date.now();
      }, { immediate: true });
      await refreshBadge(getState());
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.RESUME_SIT: {
      await updateState((s) => {
        sitTimer.resume(s.sit);
        // 恢复时从「现在」重新起算，暂停期间不扣时间
        s.meta.lastTickAt = Date.now();
      }, { immediate: true });
      await refreshBadge(getState());
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.START_BREAK: {
      const snap = await doStartBreak();
      return { ok: true, payload: snap };
    }

    case Actions.SKIP_BREAK: {
      const settings = getSettings();
      await updateState((s) => {
        sitTimer.skipBreak(s.sit, settings);
        s.meta.lastTickAt = Date.now();
      }, { immediate: true });
      await clearBreakAttention();
      await refreshBadge(getState());
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.RESET_SIT: {
      const settings = getSettings();
      await updateState((s) => {
        sitTimer.resetToFocus(s.sit, settings);
        s.meta.lastTickAt = Date.now();
      }, { immediate: true });
      await clearBreakAttention();
      await refreshBadge(getState());
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.DO_KEGEL_NOW: {
      const settings = getSettings();
      const events = [];
      let next = 0;
      await updateState((s) => {
        const r = kegelTimer.completeNow(s.kegel, settings);
        events.push(...r.events);
        next = r.nextTrigger;
        s.dailyStats.kegelCount = (s.dailyStats.kegelCount || 0) + 1;
      }, { immediate: true });
      await handleEvents(events);
      if (next) await scheduleKegelAt(next);
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.USER_ACTIVE: {
      await updateState((s) => {
        s.meta.userIdle = false;
      });
      return { ok: true };
    }

    case Actions.USER_IDLE: {
      await updateState((s) => {
        s.meta.userIdle = true;
      });
      return { ok: true };
    }

    case Actions.FULLSCREEN_ON: {
      const settings = getSettings();
      await updateState((s) => {
        s.meta.fullscreen = true;
        if (settings.isFullscreenMute) {
          s.kegel.mutedByFullscreen = true;
        }
      }, { immediate: true });
      // 全屏时收起页面横幅，避免演示尴尬
      if (settings.isFullscreenMute) {
        await hidePageBanner();
      }
      return { ok: true };
    }

    case Actions.FULLSCREEN_OFF: {
      await updateState((s) => {
        s.meta.fullscreen = false;
        s.kegel.mutedByFullscreen = false;
      }, { immediate: true });
      return { ok: true };
    }

    case Actions.PAGE_BANNER_ACTION: {
      const which = message.payload?.action;
      if (which === 'start_break') {
        const snap = await doStartBreak();
        return { ok: true, payload: snap };
      }
      if (which === 'dismiss') {
        await hidePageBanner();
        return { ok: true };
      }
      if (which === 'kegel_done') {
        // 复用手动打卡
        const settings = getSettings();
        const events = [];
        let next = 0;
        await updateState((s) => {
          const r = kegelTimer.completeNow(s.kegel, settings);
          events.push(...r.events);
          next = r.nextTrigger;
          s.dailyStats.kegelCount = (s.dailyStats.kegelCount || 0) + 1;
        }, { immediate: true });
        await handleEvents(events);
        if (next) await scheduleKegelAt(next);
        broadcastState();
        return { ok: true, payload: getSnapshot() };
      }
      return { ok: true };
    }

    case Actions.SET_CUSTOM_SOUND: {
      const { dataUrl, name, mime, size } = message.payload || {};
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/')) {
        return { ok: false, error: '无效的音频文件' };
      }
      // dataURL 约 4/3 膨胀；粗略用字符串长度估算
      if (dataUrl.length > CUSTOM_SOUND_MAX_BYTES * 1.5) {
        return { ok: false, error: '音频过大，请选择约 1.5MB 以内的文件' };
      }
      await setCustomSound({ dataUrl, name, mime, size });
      await updateSettings(
        {
          hasCustomSound: true,
          customSoundName: name || 'custom',
          soundStyle: 'custom',
        },
        { immediate: true }
      );
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.CLEAR_CUSTOM_SOUND: {
      await clearCustomSound();
      const settings = getSettings();
      const nextStyle =
        settings.soundStyle === 'custom' ? 'default' : settings.soundStyle;
      await updateSettings(
        {
          hasCustomSound: false,
          customSoundName: '',
          soundStyle: nextStyle,
        },
        { immediate: true }
      );
      broadcastState();
      return { ok: true, payload: getSnapshot() };
    }

    case Actions.PREVIEW_SOUND: {
      const kind = message.payload?.kind || 'break';
      await playAlertTone(kind, { force: true, preview: true });
      return { ok: true };
    }

    // offscreen 回执忽略
    case Actions.PLAY_NOTIFY:
      return { ok: true };

    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
}

// ─── 系统空闲检测（chrome.idle） ───────────────────────

try {
  chrome.idle.setDetectionInterval(60);
  chrome.idle.onStateChanged.addListener(async (idleState) => {
    await ensureBoot();
    await updateState((s) => {
      s.meta.userIdle = idleState === 'idle' || idleState === 'locked';
    });
  });
} catch (e) {
  console.warn('[bg] idle API unavailable', e);
}

// ─── 生命周期绑定 ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[bg] onInstalled', details.reason);
  bootPromise = null;
  await ensureBoot();
});

chrome.runtime.onStartup.addListener(async () => {
  bootPromise = null;
  await ensureBoot();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    await ensureBoot();
    if (alarm.name === ALARM.SIT_TIMER) {
      await advanceSit();
      await rescheduleSitAlarmIfDebug();
    } else if (alarm.name === ALARM.KEGEL_REMINDER) {
      await fireKegel();
    } else if (alarm.name === ALARM.OFFSCREEN_CLEANUP) {
      await closeOffscreen();
    } else if (alarm.name === ALARM.BADGE_BLINK) {
      await onBadgeBlink();
    } else if (alarm.name === ALARM.URGENT_NUDGE) {
      await onUrgentNudge();
    }
  } catch (e) {
    console.error('[bg] alarm handler error', alarm?.name, e);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  onMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[bg] message error', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
  return true; // async
});

// 立即启动
ensureBoot();

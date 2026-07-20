/**
 * Alarm 注册与动态续期
 */

import {
  ALARM,
  SIT_TICK_MINUTES,
  DEBUG_MODE,
  BADGE_BLINK_MINUTES,
  URGENT_NUDGE_MINUTES,
} from '../shared/constants.js';

/**
 * Sit 心跳
 * - 正式：每 1 分钟 period 闹钟
 * - DEBUG：一次性闹钟动态续期（约 6s），规避 periodInMinutes 最小 1 分钟限制
 */
export async function ensureSitAlarm() {
  const existing = await chrome.alarms.get(ALARM.SIT_TIMER);
  if (existing) return;

  if (DEBUG_MODE) {
    await chrome.alarms.create(ALARM.SIT_TIMER, {
      delayInMinutes: 0.1, // ≈ 6s
    });
    return;
  }

  await chrome.alarms.create(ALARM.SIT_TIMER, {
    delayInMinutes: SIT_TICK_MINUTES,
    periodInMinutes: SIT_TICK_MINUTES,
  });
}

/** DEBUG 模式下每次 tick 后重新挂载一次性 Sit Alarm */
export async function rescheduleSitAlarmIfDebug() {
  if (!DEBUG_MODE) return;
  await chrome.alarms.clear(ALARM.SIT_TIMER);
  await chrome.alarms.create(ALARM.SIT_TIMER, {
    delayInMinutes: 0.1,
  });
}

/**
 * 为 Kegel 创建一次性 Alarm，到期后由业务再续期
 * @param {number} whenMs - 绝对时间戳
 */
export async function scheduleKegelAt(whenMs) {
  const delayMs = Math.max(1000, whenMs - Date.now());
  const delayInMinutes = Math.max(0.05, delayMs / 60_000);
  // 先清再建，避免堆积
  await chrome.alarms.clear(ALARM.KEGEL_REMINDER);
  await chrome.alarms.create(ALARM.KEGEL_REMINDER, {
    delayInMinutes,
  });
}

export async function clearKegelAlarm() {
  await chrome.alarms.clear(ALARM.KEGEL_REMINDER);
}

export async function scheduleOffscreenCleanup(delayMs = 5000) {
  const delayInMinutes = Math.max(0.05, delayMs / 60_000);
  await chrome.alarms.clear(ALARM.OFFSCREEN_CLEANUP);
  await chrome.alarms.create(ALARM.OFFSCREEN_CLEANUP, { delayInMinutes });
}

/** 角标闪烁：一次性闹钟链，约每 3 秒切换一次 */
export async function scheduleBadgeBlink() {
  await chrome.alarms.clear(ALARM.BADGE_BLINK);
  await chrome.alarms.create(ALARM.BADGE_BLINK, {
    delayInMinutes: BADGE_BLINK_MINUTES,
  });
}

export async function clearBadgeBlink() {
  await chrome.alarms.clear(ALARM.BADGE_BLINK);
}

/** 紧急态复响：每 N 分钟再提醒一次 */
export async function scheduleUrgentNudge() {
  await chrome.alarms.clear(ALARM.URGENT_NUDGE);
  await chrome.alarms.create(ALARM.URGENT_NUDGE, {
    delayInMinutes: URGENT_NUDGE_MINUTES,
  });
}

export async function clearUrgentNudge() {
  await chrome.alarms.clear(ALARM.URGENT_NUDGE);
}

export async function ensureAllAlarms(kegelNextMs) {
  await ensureSitAlarm();
  if (kegelNextMs && kegelNextMs > Date.now()) {
    await scheduleKegelAt(kegelNextMs);
  }
}

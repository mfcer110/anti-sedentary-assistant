/**
 * 久坐计时器：FOCUSING → BREAK_PENDING → BREAK_URGENT / RESTING → FOCUSING
 */

import { BaseTimer } from './BaseTimer.js';
import {
  SIT_PHASE,
  BREAK_URGENT_AFTER_SECONDS,
  minutesToSeconds,
} from '../../shared/constants.js';

export class SitTimer extends BaseTimer {
  constructor() {
    super({ name: 'SitTimer' });
  }

  /**
   * @param {object} sit - state.sit
   * @param {number} deltaSeconds
   * @param {{ settings: object }} ctx
   */
  tick(sit, deltaSeconds, ctx) {
    const events = [];
    if (!sit || sit.isPaused) {
      return { changed: false, events };
    }

    const phase = sit.phase;
    let changed = false;

    if (phase === SIT_PHASE.FOCUSING) {
      const before = sit.remainSeconds;
      sit.remainSeconds = Math.max(0, sit.remainSeconds - deltaSeconds);
      changed = sit.remainSeconds !== before;

      if (before > 60 && sit.remainSeconds <= 60 && sit.remainSeconds > 0) {
        events.push('SIT_WARN');
      }
      if (sit.remainSeconds <= 0) {
        sit.remainSeconds = 0;
        sit.phase = SIT_PHASE.BREAK_PENDING;
        sit.pendingSince = Math.floor(Date.now() / 1000);
        events.push('SIT_BREAK_PENDING');
        changed = true;
      }
    } else if (phase === SIT_PHASE.BREAK_PENDING) {
      // 等待用户点「开始休息」；超时升紧急
      const nowSec = Math.floor(Date.now() / 1000);
      const since = sit.pendingSince || nowSec;
      if (nowSec - since >= BREAK_URGENT_AFTER_SECONDS) {
        sit.phase = SIT_PHASE.BREAK_URGENT;
        events.push('SIT_BREAK_URGENT');
        changed = true;
      }
    } else if (phase === SIT_PHASE.BREAK_URGENT) {
      // 维持紧急态，不自动降级
    } else if (phase === SIT_PHASE.RESTING) {
      const before = sit.remainSeconds;
      sit.remainSeconds = Math.max(0, sit.remainSeconds - deltaSeconds);
      changed = sit.remainSeconds !== before;
      if (sit.remainSeconds <= 0) {
        // 休息结束 → 回到专注
        const total = minutesToSeconds(ctx.settings.workDuration);
        sit.phase = SIT_PHASE.FOCUSING;
        sit.remainSeconds = total;
        sit.totalSeconds = total;
        sit.pendingSince = null;
        events.push('SIT_REST_DONE');
        changed = true;
      }
    } else if (phase === SIT_PHASE.PAUSED) {
      // 显式暂停相位（与 isPaused 冗余兼容）
    }

    return { changed, events };
  }

  /** 用户点击「开始休息」 */
  startBreak(sit, settings) {
    if (
      sit.phase !== SIT_PHASE.BREAK_PENDING &&
      sit.phase !== SIT_PHASE.BREAK_URGENT &&
      sit.phase !== SIT_PHASE.FOCUSING
    ) {
      return { ok: false, events: [] };
    }
    const total = minutesToSeconds(settings.breakDuration);
    sit.phase = SIT_PHASE.RESTING;
    sit.remainSeconds = total;
    sit.totalSeconds = total;
    sit.isPaused = false;
    sit.pendingSince = null;
    return { ok: true, events: ['SIT_REST_START'] };
  }

  /** 跳过休息，直接进入下一轮专注 */
  skipBreak(sit, settings) {
    const total = minutesToSeconds(settings.workDuration);
    sit.phase = SIT_PHASE.FOCUSING;
    sit.remainSeconds = total;
    sit.totalSeconds = total;
    sit.isPaused = false;
    sit.pendingSince = null;
    return { ok: true, events: ['SIT_SKIP_BREAK'] };
  }

  pause(sit) {
    if (sit.phase === SIT_PHASE.RESTING) {
      // 休息中也允许暂停
    }
    if (sit.isPaused) return false;
    sit.isPaused = true;
    if (sit.phase === SIT_PHASE.FOCUSING) {
      sit.phase = SIT_PHASE.PAUSED;
    }
    return true;
  }

  resume(sit) {
    if (!sit.isPaused && sit.phase !== SIT_PHASE.PAUSED) return false;
    sit.isPaused = false;
    if (sit.phase === SIT_PHASE.PAUSED) {
      sit.phase = SIT_PHASE.FOCUSING;
    }
    return true;
  }

  resetToFocus(sit, settings) {
    const total = minutesToSeconds(settings.workDuration);
    sit.phase = SIT_PHASE.FOCUSING;
    sit.remainSeconds = total;
    sit.totalSeconds = total;
    sit.isPaused = false;
    sit.pendingSince = null;
  }
}

export const sitTimer = new SitTimer();

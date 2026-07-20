/**
 * 微动（提肛）计时器：简单循环触发
 * 不依赖秒级心跳，由独立 Alarm 动态续期
 */

import { minutesToSeconds } from '../../shared/constants.js';

export class KegelTimer {
  constructor() {
    this.name = 'KegelTimer';
  }

  /**
   * 计算下次触发时间戳（ms）
   * @param {number} intervalMinutes
   * @param {number} [fromMs]
   */
  nextTriggerAt(intervalMinutes, fromMs = Date.now()) {
    const intervalMs = Math.max(10_000, minutesToSeconds(intervalMinutes) * 1000);
    return fromMs + intervalMs;
  }

  /**
   * 是否到期
   * @param {object} kegel - state.kegel
   */
  isDue(kegel, now = Date.now()) {
    if (!kegel || !kegel.nextTrigger) return true;
    return now >= kegel.nextTrigger;
  }

  /**
   * 触发一次并安排下次
   * @returns {{ events: string[], nextTrigger: number }}
   */
  fire(kegel, settings, now = Date.now()) {
    const events = [];
    if (kegel.mutedByFullscreen) {
      // 全屏静默：顺延一次，不计数、不通知
      kegel.nextTrigger = this.nextTriggerAt(settings.kegelInterval, now);
      events.push('KEGEL_MUTED_SKIP');
      return { events, nextTrigger: kegel.nextTrigger };
    }
    if (!settings.kegelEnabled) {
      kegel.nextTrigger = this.nextTriggerAt(settings.kegelInterval, now);
      events.push('KEGEL_DISABLED_SKIP');
      return { events, nextTrigger: kegel.nextTrigger };
    }
    kegel.nextTrigger = this.nextTriggerAt(settings.kegelInterval, now);
    events.push('KEGEL_REMIND');
    return { events, nextTrigger: kegel.nextTrigger };
  }

  /** 手动完成一组：计数 +1，并重置下次时间 */
  completeNow(kegel, settings, now = Date.now()) {
    kegel.nextTrigger = this.nextTriggerAt(settings.kegelInterval, now);
    return { events: ['KEGEL_DONE_MANUAL'], nextTrigger: kegel.nextTrigger };
  }
}

export const kegelTimer = new KegelTimer();

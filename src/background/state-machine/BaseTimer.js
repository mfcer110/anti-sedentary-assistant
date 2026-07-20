/**
 * 计时器基类：暂停 / 恢复 / 重置 / 推进
 * 不直接读写 storage，由上层注入状态片段
 */

export class BaseTimer {
  /**
   * @param {object} options
   * @param {string} options.name
   */
  constructor({ name }) {
    this.name = name;
  }

  /**
   * 推进 n 秒（子类覆盖）
   * @param {object} slice - 可变状态片段
   * @param {number} deltaSeconds
   * @param {object} ctx - 额外上下文（settings 等）
   * @returns {{ changed: boolean, events: string[] }}
   */
  tick(slice, deltaSeconds, ctx) {
    throw new Error(`${this.name}.tick() not implemented`);
  }

  pause(slice) {
    if (slice.isPaused) return false;
    slice.isPaused = true;
    return true;
  }

  resume(slice) {
    if (!slice.isPaused) return false;
    slice.isPaused = false;
    return true;
  }

  /**
   * @param {object} slice
   * @param {number} totalSeconds
   */
  reset(slice, totalSeconds) {
    slice.remainSeconds = totalSeconds;
    slice.totalSeconds = totalSeconds;
    slice.isPaused = false;
  }
}

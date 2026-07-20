/**
 * 今日完成统计面板
 */

export class StatsBoard {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.els = {
      kegel: root.querySelector('[data-stat="kegel"]'),
      breaks: root.querySelector('[data-stat="breaks"]'),
      focus: root.querySelector('[data-stat="focus"]'),
      date: root.querySelector('[data-stat="date"]'),
    };
  }

  /**
   * @param {{ kegelCount?: number, breakCount?: number, focusMinutes?: number, date?: string }} stats
   */
  render(stats = {}) {
    if (this.els.kegel) {
      this.els.kegel.textContent = String(stats.kegelCount ?? 0);
    }
    if (this.els.breaks) {
      this.els.breaks.textContent = String(stats.breakCount ?? 0);
    }
    if (this.els.focus) {
      const m = Math.round(stats.focusMinutes || 0);
      this.els.focus.textContent = m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`;
    }
    if (this.els.date && stats.date) {
      this.els.date.textContent = stats.date;
    }
  }
}

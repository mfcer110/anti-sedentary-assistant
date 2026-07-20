/**
 * SVG 环形进度条
 * 使用 stroke-dashoffset + transform，避免 layout reflow
 */

export class ProgressRing {
  /**
   * @param {SVGElement} svg
   * @param {{ size?: number, stroke?: number }} opts
   */
  constructor(svg, opts = {}) {
    this.svg = svg;
    this.size = opts.size ?? 160;
    this.stroke = opts.stroke ?? 10;
    this.radius = (this.size - this.stroke) / 2;
    this.circumference = 2 * Math.PI * this.radius;

    this.track = svg.querySelector('[data-ring-track]');
    this.progress = svg.querySelector('[data-ring-progress]');
    this.label = svg.querySelector('[data-ring-label]');
    this.sub = svg.querySelector('[data-ring-sub]');

    this._setup();
  }

  _setup() {
    const c = this.circumference;
    if (this.track) {
      this.track.setAttribute('r', this.radius);
      this.track.setAttribute('stroke-width', this.stroke);
      this.track.setAttribute('cx', this.size / 2);
      this.track.setAttribute('cy', this.size / 2);
    }
    if (this.progress) {
      this.progress.setAttribute('r', this.radius);
      this.progress.setAttribute('stroke-width', this.stroke);
      this.progress.setAttribute('cx', this.size / 2);
      this.progress.setAttribute('cy', this.size / 2);
      this.progress.style.strokeDasharray = `${c} ${c}`;
      this.progress.style.strokeDashoffset = String(c);
      // 从顶部开始
      this.progress.style.transformOrigin = '50% 50%';
      this.progress.style.transform = 'rotate(-90deg)';
    }
  }

  /**
   * @param {number} ratio 0-1 已完成比例
   * @param {{ color?: string, label?: string, sub?: string }} opts
   */
  setProgress(ratio, opts = {}) {
    const r = Math.min(1, Math.max(0, ratio));
    const offset = this.circumference * (1 - r);
    if (this.progress) {
      this.progress.style.strokeDashoffset = String(offset);
      if (opts.color) this.progress.style.stroke = opts.color;
    }
    if (this.label && opts.label != null) this.label.textContent = opts.label;
    if (this.sub && opts.sub != null) this.sub.textContent = opts.sub;
  }

  setColor(color) {
    if (this.progress) this.progress.style.stroke = color;
  }
}

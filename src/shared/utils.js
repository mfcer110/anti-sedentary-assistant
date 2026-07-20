/**
 * 纯工具函数：时间格式化、防抖、节流
 */

/** 秒 -> mm:ss 或 h:mm:ss */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** 分钟文案，如 50min / 1h 20min */
export function formatMinutes(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`;
}

/** 防抖 */
export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

/** 节流（trailing + leading 可选） */
export function throttle(fn, wait = 1000, { leading = true, trailing = true } = {}) {
  let last = 0;
  let timer = null;
  let lastArgs = null;

  const invoke = (ctx, args) => {
    last = Date.now();
    fn.apply(ctx, args);
  };

  return function throttled(...args) {
    const now = Date.now();
    lastArgs = args;
    if (!last && !leading) last = now;

    const remaining = wait - (now - last);
    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(this, args);
    } else if (trailing && !timer) {
      timer = setTimeout(() => {
        timer = null;
        if (trailing && lastArgs) invoke(this, lastArgs);
      }, remaining);
    }
  };
}

/** 安全 JSON 深拷贝（仅普通对象/数组） */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 夹紧数字 */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 环形进度 0-1 */
export function progressRatio(remain, total) {
  if (!total || total <= 0) return 0;
  return clamp(1 - remain / total, 0, 1);
}

/**
 * Content Script：
 * 1) 监听用户活跃度与全屏状态
 * 2) 在页面角落展示统一风格提醒卡片（替代系统通知）
 */

(() => {
  const Actions = {
    USER_ACTIVE: 'USER_ACTIVE',
    USER_IDLE: 'USER_IDLE',
    FULLSCREEN_ON: 'FULLSCREEN_ON',
    FULLSCREEN_OFF: 'FULLSCREEN_OFF',
    SHOW_PAGE_BANNER: 'SHOW_PAGE_BANNER',
    HIDE_PAGE_BANNER: 'HIDE_PAGE_BANNER',
    PAGE_BANNER_ACTION: 'PAGE_BANNER_ACTION',
  };

  const IDLE_MS = 60_000;
  const HOST_ID = 'jz-motion-banner-host';
  let idleTimer = null;
  let isIdle = false;
  let wasFullscreen = false;
  let lastActiveSent = 0;
  let autoHideTimer = null;
  let hideAnimTimer = null;

  function send(action, payload) {
    try {
      chrome.runtime.sendMessage({ action, payload }).catch(() => {});
    } catch (_) {
      // extension context invalidated
    }
  }

  // ─── 活跃度 / 全屏 ───────────────────────────────────

  function markActive() {
    const now = Date.now();
    if (isIdle) {
      isIdle = false;
      send(Actions.USER_ACTIVE);
    } else if (now - lastActiveSent > 30_000) {
      lastActiveSent = now;
      send(Actions.USER_ACTIVE);
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      isIdle = true;
      send(Actions.USER_IDLE);
    }, IDLE_MS);
  }

  function checkFullscreen() {
    const fs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
    if (fs !== wasFullscreen) {
      wasFullscreen = fs;
      send(fs ? Actions.FULLSCREEN_ON : Actions.FULLSCREEN_OFF);
      if (fs) hideBanner();
    }
  }

  const activityEvents = [
    'mousemove',
    'mousedown',
    'keydown',
    'scroll',
    'touchstart',
    'wheel',
  ];

  for (const ev of activityEvents) {
    window.addEventListener(ev, markActive, { passive: true, capture: true });
  }

  document.addEventListener('fullscreenchange', checkFullscreen);
  document.addEventListener('webkitfullscreenchange', checkFullscreen);

  // ─── 页面卡片 ────────────────────────────────────────
  // 扩展重载后旧 content script 的 DOM 会残留，启动时 purge。

  function hostBaseStyle(visible) {
    return [
      'all: initial',
      'position: fixed',
      'z-index: 2147483646',
      'right: 24px',
      'bottom: 24px',
      'width: 340px',
      'max-width: calc(100vw - 32px)',
      'font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      'pointer-events: none',
      visible ? 'display: block' : 'display: none',
    ].join(';');
  }

  function purgeHosts() {
    document.querySelectorAll(`#${HOST_ID}`).forEach((el) => {
      try {
        el.remove();
      } catch (_) {}
    });
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host && !host.shadowRoot) {
      try {
        host.remove();
      } catch (_) {}
      host = null;
    }
    if (host) {
      host.style.cssText = hostBaseStyle(true);
      return host;
    }

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = hostBaseStyle(true);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      .card {
        pointer-events: auto;
        color: #1f2937;
        background: #ffffff;
        border-radius: 20px;
        border: 1px solid rgba(15, 23, 42, 0.06);
        border-left: 5px solid #ef4444;
        box-shadow:
          0 18px 50px rgba(15, 23, 42, 0.16),
          0 4px 14px rgba(15, 23, 42, 0.06);
        padding: 16px 16px 14px;
        transform: translateY(14px) scale(0.98);
        opacity: 0;
        transition: transform .22s ease, opacity .22s ease;
      }
      .card:empty,
      .card:not(.show) {
        opacity: 0 !important;
        pointer-events: none !important;
        box-shadow: none !important;
        background: transparent !important;
        border-color: transparent !important;
        padding: 0 !important;
        min-height: 0 !important;
      }
      .card:empty { display: none !important; }
      .card.show:not(:empty) {
        transform: translateY(0) scale(1);
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      .card.warn { border-left-color: #f59e0b; }
      .card.break { border-left-color: #ef4444; }
      .card.urgent {
        border-left-color: #dc2626;
        animation: pulse 1.25s ease-in-out infinite;
      }
      .card.kegel { border-left-color: #22c55e; }
      .card.info { border-left-color: #3b82f6; }
      .card.success { border-left-color: #10b981; }

      @keyframes pulse {
        0%, 100% { box-shadow: 0 18px 50px rgba(220, 38, 38, 0.14); }
        50% { box-shadow: 0 18px 56px rgba(220, 38, 38, 0.28); }
      }

      .top {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-top: 6px;
        flex: 0 0 auto;
        background: #ef4444;
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
      }
      .card.warn .dot {
        background: #f59e0b;
        box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14);
      }
      .card.break .dot,
      .card.urgent .dot {
        background: #ef4444;
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.14);
      }
      .card.kegel .dot,
      .card.success .dot {
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
      }
      .card.info .dot {
        background: #3b82f6;
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.14);
      }

      .body { flex: 1; min-width: 0; }
      .title {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        margin: 0 0 6px;
        color: #111827;
        letter-spacing: 0.01em;
      }
      .msg {
        font-size: 13px;
        line-height: 1.55;
        margin: 0;
        color: #6b7280;
      }
      .close {
        border: 0;
        background: transparent;
        color: #9ca3af;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0 2px;
        margin-top: -2px;
      }
      .close:hover { color: #374151; }

      .actions {
        display: flex;
        gap: 10px;
        margin-top: 14px;
      }
      .btn {
        flex: 1;
        border: 0;
        border-radius: 999px;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
        font-family: inherit;
        transition: filter .12s ease, transform .12s ease, background .12s ease;
      }
      .btn:active { transform: scale(0.98); }
      .btn.primary {
        background: linear-gradient(90deg, #ff5a4e 0%, #ff8a3d 100%);
        color: #fff;
        box-shadow: 0 8px 18px rgba(255, 90, 78, 0.28);
      }
      .btn.primary:hover { filter: brightness(1.04); }
      .btn.ghost {
        background: #f3f4f6;
        color: #4b5563;
      }
      .btn.ghost:hover { background: #e5e7eb; }
      .btn.green {
        background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
        color: #fff;
        box-shadow: 0 8px 18px rgba(34, 197, 94, 0.24);
      }
      .btn.blue {
        background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
        color: #fff;
        box-shadow: 0 8px 18px rgba(59, 130, 246, 0.24);
      }
    `;
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    shadow.appendChild(card);

    const mount = () => {
      if (!document.documentElement.contains(host)) {
        (document.body || document.documentElement).appendChild(host);
      }
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });

    return host;
  }

  function hideBanner() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    if (hideAnimTimer) {
      clearTimeout(hideAnimTimer);
      hideAnimTimer = null;
    }

    const host = document.getElementById(HOST_ID);
    if (!host) return;

    const card = host.shadowRoot?.querySelector('.card');
    if (card) {
      card.classList.remove('show');
      hideAnimTimer = setTimeout(() => {
        hideAnimTimer = null;
        try {
          card.innerHTML = '';
          card.className = 'card';
          host.remove();
        } catch (_) {
          try {
            host.style.cssText = hostBaseStyle(false);
          } catch (__) {}
        }
      }, 220);
    } else {
      try {
        host.remove();
      } catch (_) {}
    }
  }

  function makeBtn(className, text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${className}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * payload:
   *  - level: warn | break | urgent | kegel | info | success
   *  - title, message
   *  - actions: 'break' | 'kegel' | 'ok' | 'none'
   *  - autoHideMs?: number
   */
  function showBanner(payload = {}) {
    if (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    ) {
      return;
    }

    if (hideAnimTimer) {
      clearTimeout(hideAnimTimer);
      hideAnimTimer = null;
    }
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    const host = ensureHost();
    const card = host.shadowRoot?.querySelector('.card');
    if (!card) return;

    const level = payload.level || 'break';
    const title = payload.title || '提醒';
    const message = payload.message || '';
    let actionsMode = payload.actions;
    if (!actionsMode) {
      if (level === 'break' || level === 'urgent') actionsMode = 'break';
      else if (level === 'kegel') actionsMode = 'kegel';
      else if (level === 'warn' || level === 'info' || level === 'success') {
        actionsMode = 'ok';
      } else {
        actionsMode = 'none';
      }
    }

    card.className = `card ${level}`;
    card.innerHTML = '';
    host.style.cssText = hostBaseStyle(true);

    const top = document.createElement('div');
    top.className = 'top';

    const dot = document.createElement('div');
    dot.className = 'dot';
    top.appendChild(dot);

    const body = document.createElement('div');
    body.className = 'body';
    const h = document.createElement('p');
    h.className = 'title';
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'msg';
    p.textContent = message;
    body.appendChild(h);
    body.appendChild(p);
    top.appendChild(body);

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '×';
    close.addEventListener('click', () => {
      hideBanner();
      send(Actions.PAGE_BANNER_ACTION, { action: 'dismiss' });
    });
    top.appendChild(close);
    card.appendChild(top);

    if (actionsMode === 'break') {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(
        makeBtn('primary', '开始休息', () => {
          send(Actions.PAGE_BANNER_ACTION, { action: 'start_break' });
          hideBanner();
        })
      );
      actions.appendChild(
        makeBtn('ghost', '稍后', () => {
          hideBanner();
          send(Actions.PAGE_BANNER_ACTION, { action: 'dismiss' });
        })
      );
      card.appendChild(actions);
    } else if (actionsMode === 'kegel') {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(
        makeBtn('green', '做完了', () => {
          send(Actions.PAGE_BANNER_ACTION, { action: 'kegel_done' });
          hideBanner();
        })
      );
      actions.appendChild(
        makeBtn('ghost', '稍后', () => {
          hideBanner();
          send(Actions.PAGE_BANNER_ACTION, { action: 'dismiss' });
        })
      );
      card.appendChild(actions);
    } else if (actionsMode === 'ok') {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const okClass =
        level === 'success' ? 'green' : level === 'info' ? 'blue' : 'primary';
      actions.appendChild(
        makeBtn(okClass, '知道了', () => {
          hideBanner();
          send(Actions.PAGE_BANNER_ACTION, { action: 'dismiss' });
        })
      );
      card.appendChild(actions);
    }

    requestAnimationFrame(() => {
      if (card.childNodes.length) card.classList.add('show');
    });

    const autoHideMs =
      payload.autoHideMs ??
      (actionsMode === 'break'
        ? 0
        : level === 'kegel'
          ? 20_000
          : level === 'urgent'
            ? 0
            : 12_000);
    if (autoHideMs > 0) {
      autoHideTimer = setTimeout(hideBanner, autoHideMs);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.action) return;
    if (message.action === Actions.SHOW_PAGE_BANNER) {
      showBanner(message.payload || {});
    } else if (message.action === Actions.HIDE_PAGE_BANNER) {
      hideBanner();
    }
  });

  purgeHosts();
  markActive();
  checkFullscreen();
})();

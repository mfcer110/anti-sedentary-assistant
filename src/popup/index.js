/**
 * Popup UI：展示状态 + 触发动作
 * 通过 runtime.sendMessage 与 SW 通信；监听 STATE_UPDATED
 */

import {
  Actions,
  COPY,
  SIT_PHASE,
  CUSTOM_SOUND_MAX_BYTES,
  PROJECT_URL,
  PROJECT_REPO,
  PROJECT_MANIFEST_RAW,
  PROJECT_RELEASES_API,
} from '../shared/constants.js';
import { formatDuration, progressRatio } from '../shared/utils.js';
import { ProgressRing } from './components/ProgressRing.js';
import { StatsBoard } from './components/StatsBoard.js';

const $ = (sel) => document.querySelector(sel);

const ui = {
  phaseLabel: $('#phaseLabel'),
  pauseIcon: $('#pauseIcon'),
  btnPause: $('#btnPause'),
  btnStartBreak: $('#btnStartBreak'),
  btnSkipBreak: $('#btnSkipBreak'),
  breakActions: $('#breakActions'),
  btnKegel: $('#btnKegel'),
  kegelCount: $('#kegelCount'),
  kegelNext: $('#kegelNext'),
  kegelEnabled: $('#kegelEnabled'),
  workDuration: $('#workDuration'),
  breakDuration: $('#breakDuration'),
  kegelInterval: $('#kegelInterval'),
  isFullscreenMute: $('#isFullscreenMute'),
  soundAlerts: $('#soundAlerts'),
  pageBanner: $('#pageBanner'),
  windowFlash: $('#windowFlash'),
  soundVolume: $('#soundVolume'),
  soundVolumeLabel: $('#soundVolumeLabel'),
  soundStyle: $('#soundStyle'),
  btnPreviewSound: $('#btnPreviewSound'),
  customSoundFile: $('#customSoundFile'),
  btnClearSound: $('#btnClearSound'),
  customSoundHint: $('#customSoundHint'),
  soundBlock: $('#soundBlock'),
  btnSave: $('#btnSave'),
  btnReset: $('#btnReset'),
  progressRing: $('#progressRing'),
  statsBoard: $('#statsBoard'),
  projectLink: $('#projectLink'),
  btnCheckUpdate: $('#btnCheckUpdate'),
  updateStatus: $('#updateStatus'),
  appVersion: $('#appVersion'),
};

const ring = new ProgressRing(ui.progressRing, { size: 168, stroke: 10 });
const stats = new StatsBoard(ui.statsBoard);

let latest = null;
let tickTimer = null;
let localRemain = 0;
let localPhase = SIT_PHASE.FOCUSING;
let localPaused = false;
let localTotal = 1;

function send(action, payload) {
  return chrome.runtime.sendMessage({ action, payload });
}

function phaseColor(phase) {
  switch (phase) {
    case SIT_PHASE.BREAK_PENDING:
      return '#fbbf24';
    case SIT_PHASE.BREAK_URGENT:
      return '#f87171';
    case SIT_PHASE.RESTING:
      return '#34d399';
    case SIT_PHASE.PAUSED:
      return '#94a3b8';
    default:
      return '#60a5fa';
  }
}

function updateSoundUi(settings) {
  const vol = settings.soundVolume ?? 80;
  if (ui.soundVolume) ui.soundVolume.value = String(vol);
  if (ui.soundVolumeLabel) ui.soundVolumeLabel.textContent = `${vol}%`;
  if (ui.soundStyle) {
    const style = settings.soundStyle || 'default';
    // 未上传自定义时，若当前是 custom 也允许显示
    ui.soundStyle.value = style;
  }
  if (ui.windowFlash) {
    ui.windowFlash.checked = settings.windowFlash !== false;
  }

  const hasCustom = !!settings.hasCustomSound;
  if (ui.btnClearSound) ui.btnClearSound.hidden = !hasCustom;
  if (ui.customSoundHint) {
    if (hasCustom && settings.customSoundName) {
      ui.customSoundHint.textContent = `已加载：${settings.customSoundName}（仅本机）`;
    } else {
      ui.customSoundHint.textContent =
        '可上传 mp3 / wav（约 1.5MB 内），数据仅存本机。';
    }
  }

  // 关闭提示音时灰掉音量子面板
  if (ui.soundBlock) {
    ui.soundBlock.classList.toggle('disabled', settings.soundAlerts === false);
  }
}

function renderFromSnapshot(snap) {
  latest = snap;
  const { settings, state } = snap;
  const sit = state.sit;

  localRemain = sit.remainSeconds;
  localTotal = sit.totalSeconds || 1;
  localPhase = sit.phase;
  localPaused = !!sit.isPaused || sit.phase === SIT_PHASE.PAUSED;

  document.body.dataset.phase = sit.phase;

  ui.phaseLabel.textContent = COPY.phaseLabel[sit.phase] || sit.phase;
  ui.pauseIcon.textContent = localPaused ? '▶' : '❚❚';

  // 休息操作区
  const needBreak =
    sit.phase === SIT_PHASE.BREAK_PENDING ||
    sit.phase === SIT_PHASE.BREAK_URGENT;
  ui.breakActions.hidden = !needBreak;

  // 环形进度：FOCUSING/RESTING 显示倒计时进度
  const ratio = progressRatio(localRemain, localTotal);
  ring.setProgress(ratio, {
    color: phaseColor(sit.phase),
    label: formatDuration(localRemain),
    sub:
      sit.phase === SIT_PHASE.RESTING
        ? '休息剩余'
        : needBreak
          ? '请休息'
          : localPaused
            ? '已暂停'
            : '剩余',
  });

  // 微动
  ui.kegelCount.textContent = String(state.dailyStats.kegelCount || 0);
  ui.kegelEnabled.checked = !!settings.kegelEnabled;
  updateKegelNext(state.kegel.nextTrigger, settings.kegelEnabled);

  // 设置表单
  ui.workDuration.value = settings.workDuration;
  ui.breakDuration.value = settings.breakDuration;
  ui.kegelInterval.value = settings.kegelInterval;
  ui.isFullscreenMute.checked = !!settings.isFullscreenMute;
  ui.soundAlerts.checked = settings.soundAlerts !== false;
  if (ui.pageBanner) {
    ui.pageBanner.checked = settings.pageBanner !== false;
  }
  updateSoundUi(settings);

  stats.render(state.dailyStats);

  // 本地秒级刷新（仅 UI，真实权威仍在 SW）
  startLocalTick();
}

function updateKegelNext(nextTrigger, enabled) {
  if (!enabled) {
    ui.kegelNext.textContent = '微动提醒已关闭';
    return;
  }
  if (!nextTrigger) {
    ui.kegelNext.textContent = '下次提醒待安排';
    return;
  }
  const diff = Math.max(0, nextTrigger - Date.now());
  const mins = Math.ceil(diff / 60_000);
  if (mins <= 0) {
    ui.kegelNext.textContent = '即将提醒';
  } else if (mins < 60) {
    ui.kegelNext.textContent = `约 ${mins} 分钟后提醒`;
  } else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    ui.kegelNext.textContent = `约 ${h} 小时 ${m} 分后提醒`;
  }
}

function startLocalTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (localPaused) return;
    if (
      localPhase === SIT_PHASE.FOCUSING ||
      localPhase === SIT_PHASE.RESTING
    ) {
      localRemain = Math.max(0, localRemain - 1);
      const ratio = progressRatio(localRemain, localTotal);
      ring.setProgress(ratio, {
        color: phaseColor(localPhase),
        label: formatDuration(localRemain),
        sub: localPhase === SIT_PHASE.RESTING ? '休息剩余' : '剩余',
      });
    }
    if (latest?.state?.kegel) {
      updateKegelNext(
        latest.state.kegel.nextTrigger,
        latest.settings?.kegelEnabled
      );
    }
  }, 1000);
}

async function refresh() {
  const res = await send(Actions.GET_STATE);
  if (res?.ok && res.payload) {
    renderFromSnapshot(res.payload);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

// ─── 事件绑定 ──────────────────────────────────────────

ui.btnPause.addEventListener('click', async () => {
  const action = localPaused ? Actions.RESUME_SIT : Actions.PAUSE_SIT;
  const res = await send(action);
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

ui.btnStartBreak.addEventListener('click', async () => {
  const res = await send(Actions.START_BREAK);
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

ui.btnSkipBreak.addEventListener('click', async () => {
  const res = await send(Actions.SKIP_BREAK);
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

ui.btnKegel.addEventListener('click', async () => {
  ui.btnKegel.classList.remove('pop');
  // reflow to restart animation
  void ui.btnKegel.offsetWidth;
  ui.btnKegel.classList.add('pop');
  const res = await send(Actions.DO_KEGEL_NOW);
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

ui.kegelEnabled.addEventListener('change', async () => {
  const res = await send(Actions.UPDATE_SETTINGS, {
    kegelEnabled: ui.kegelEnabled.checked,
  });
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

if (ui.soundVolume) {
  ui.soundVolume.addEventListener('input', () => {
    const v = Number(ui.soundVolume.value) || 0;
    if (ui.soundVolumeLabel) ui.soundVolumeLabel.textContent = `${v}%`;
  });
}

if (ui.btnPreviewSound) {
  ui.btnPreviewSound.addEventListener('click', async () => {
    // 仅同步当前 UI 的音量/风格到后台（不强制打开 soundAlerts）
    await send(Actions.UPDATE_SETTINGS, {
      soundVolume: clampNum(ui.soundVolume?.value, 0, 100, 80),
      soundStyle: ui.soundStyle?.value || 'default',
    });
    ui.btnPreviewSound.textContent = '播放中…';
    ui.btnPreviewSound.disabled = true;
    try {
      await send(Actions.PREVIEW_SOUND, { kind: 'break' });
    } finally {
      setTimeout(() => {
        ui.btnPreviewSound.textContent = '试听';
        ui.btnPreviewSound.disabled = false;
      }, 900);
    }
  });
}

if (ui.customSoundFile) {
  ui.customSoundFile.addEventListener('change', async () => {
    const file = ui.customSoundFile.files?.[0];
    ui.customSoundFile.value = '';
    if (!file) return;
    if (file.size > CUSTOM_SOUND_MAX_BYTES) {
      if (ui.customSoundHint) {
        ui.customSoundHint.textContent = '文件过大，请选择约 1.5MB 以内的音频';
      }
      return;
    }
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) {
      if (ui.customSoundHint) {
        ui.customSoundHint.textContent = '请选择音频文件（mp3 / wav / ogg…）';
      }
      return;
    }
    try {
      if (ui.customSoundHint) ui.customSoundHint.textContent = '上传中…';
      const dataUrl = await readFileAsDataUrl(file);
      const res = await send(Actions.SET_CUSTOM_SOUND, {
        dataUrl,
        name: file.name,
        mime: file.type || 'audio/mpeg',
        size: file.size,
      });
      if (res?.ok && res.payload) {
        renderFromSnapshot(res.payload);
      } else if (ui.customSoundHint) {
        ui.customSoundHint.textContent = res?.error || '上传失败';
      }
    } catch (e) {
      console.error('[popup] custom sound', e);
      if (ui.customSoundHint) ui.customSoundHint.textContent = '读取文件失败';
    }
  });
}

if (ui.btnClearSound) {
  ui.btnClearSound.addEventListener('click', async () => {
    const res = await send(Actions.CLEAR_CUSTOM_SOUND);
    if (res?.ok && res.payload) renderFromSnapshot(res.payload);
  });
}

ui.btnSave.addEventListener('click', async () => {
  const payload = {
    workDuration: clampNum(ui.workDuration.value, 1, 180, 50),
    breakDuration: clampNum(ui.breakDuration.value, 1, 60, 10),
    kegelInterval: clampNum(ui.kegelInterval.value, 5, 120, 30),
    isFullscreenMute: ui.isFullscreenMute.checked,
    soundAlerts: ui.soundAlerts.checked,
    pageBanner: ui.pageBanner ? ui.pageBanner.checked : true,
    windowFlash: ui.windowFlash ? ui.windowFlash.checked : true,
    soundVolume: clampNum(ui.soundVolume?.value, 0, 100, 80),
    soundStyle: ui.soundStyle?.value || 'default',
    kegelEnabled: ui.kegelEnabled.checked,
  };
  // 选了 custom 但还没上传：仍允许保存，播放时回退 default
  const res = await send(Actions.UPDATE_SETTINGS, payload);
  if (res?.ok && res.payload) {
    renderFromSnapshot(res.payload);
    ui.btnSave.textContent = '已保存';
    setTimeout(() => {
      ui.btnSave.textContent = '保存';
    }, 1200);
  }
});

ui.btnReset.addEventListener('click', async () => {
  const res = await send(Actions.RESET_SIT);
  if (res?.ok && res.payload) renderFromSnapshot(res.payload);
});

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Background 推送
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === Actions.STATE_UPDATED && message.payload) {
    renderFromSnapshot(message.payload);
  }
});

// ─── 页脚：项目主页 + 检查更新 ─────────────────────────

function setUpdateStatus(text, kind = '') {
  if (!ui.updateStatus) return;
  if (!text) {
    ui.updateStatus.hidden = true;
    ui.updateStatus.textContent = '';
    ui.updateStatus.className = 'update-status';
    return;
  }
  ui.updateStatus.hidden = false;
  ui.updateStatus.textContent = text;
  ui.updateStatus.className = `update-status${kind ? ` ${kind}` : ''}`;
}

/** 简单 semver 比较：a>b → 1, a<b → -1, eq → 0 */
function cmpVersion(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function localVersion() {
  try {
    return chrome.runtime.getManifest()?.version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

async function fetchRemoteVersion() {
  // 优先 releases/latest，没有 release 时读 raw manifest.json
  try {
    const res = await fetch(PROJECT_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const data = await res.json();
      const tag = data.tag_name || data.name || '';
      if (tag) return { version: tag.replace(/^v/i, ''), url: data.html_url || PROJECT_URL };
    }
  } catch (_) {}

  const res = await fetch(PROJECT_MANIFEST_RAW, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.version) throw new Error('remote manifest has no version');
  return { version: String(data.version), url: PROJECT_URL };
}

function initProjectFooter() {
  const ver = localVersion();
  if (ui.appVersion) ui.appVersion.textContent = `v${ver}`;
  if (ui.projectLink) {
    ui.projectLink.href = PROJECT_URL;
    // 仓库尚未配置时给出提示，但仍允许打开
    if (PROJECT_REPO.startsWith('YOUR_GITHUB_USERNAME')) {
      ui.projectLink.title = '请先在 constants.js 配置真实仓库地址';
    }
  }

  if (!ui.btnCheckUpdate) return;
  ui.btnCheckUpdate.addEventListener('click', async () => {
    if (PROJECT_REPO.startsWith('YOUR_GITHUB_USERNAME')) {
      setUpdateStatus('请先配置 GitHub 仓库地址（constants.js → PROJECT_REPO）', 'err');
      return;
    }
    ui.btnCheckUpdate.disabled = true;
    const old = ui.btnCheckUpdate.textContent;
    ui.btnCheckUpdate.textContent = '检查中…';
    setUpdateStatus('正在检查更新…');
    try {
      const remote = await fetchRemoteVersion();
      const local = localVersion();
      const cmp = cmpVersion(remote.version, local);
      if (cmp > 0) {
        setUpdateStatus(`发现新版本 v${remote.version}（当前 v${local}），点击项目主页查看`, 'warn');
      } else if (cmp === 0) {
        setUpdateStatus(`已是最新版 v${local}`, 'ok');
      } else {
        setUpdateStatus(`当前 v${local} 新于远程 v${remote.version}`, 'ok');
      }
    } catch (e) {
      console.warn('[popup] check update failed', e);
      setUpdateStatus('检查失败：网络不可用或仓库尚未发布', 'err');
    } finally {
      ui.btnCheckUpdate.disabled = false;
      ui.btnCheckUpdate.textContent = old;
    }
  });
}

// 启动
initProjectFooter();
refresh().catch((err) => {
  console.error('[popup] init failed', err);
  ui.phaseLabel.textContent = '连接中…';
});

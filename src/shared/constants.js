/**
 * 默认配置、文案模板、Alarm 名称与 Action 枚举
 * 纯数据 / 纯常量，无副作用
 */

/**
 * 项目主页 / 更新检查（发布到 GitHub 后请改成真实仓库）
 * 格式：owner/repo
 */
export const PROJECT_REPO = 'YOUR_GITHUB_USERNAME/anti-sedentary-assistant';
export const PROJECT_URL = `https://github.com/${PROJECT_REPO}`;
export const PROJECT_RELEASES_API = `https://api.github.com/repos/${PROJECT_REPO}/releases/latest`;
export const PROJECT_MANIFEST_RAW =
  `https://raw.githubusercontent.com/${PROJECT_REPO}/main/manifest.json`;

export const DEBUG_MODE = false;

/** 调试模式下将分钟压缩为秒（便于快速验证状态流转） */
export const DEBUG_SCALE = DEBUG_MODE ? 1 / 60 : 1;

export const DEFAULT_SETTINGS = {
  workDuration: 50,       // 工作时长（分钟）
  breakDuration: 10,      // 休息时长（分钟）
  kegelInterval: 30,      // 微动间隔（分钟）
  kegelEnabled: true,
  isFullscreenMute: true, // 全屏自动静默
  soundAlerts: true,      // 是否允许提示音（offscreen 音效）
  pageBanner: true,       // 是否在网页内显示提醒卡片（已替代系统通知）
  windowFlash: true,      // 紧急时闪烁浏览器窗口
  /** 音量 0–100 */
  soundVolume: 80,
  /**
   * 提示音风格：
   * default | chime | pulse | bell | custom
   */
  soundStyle: 'default',
  /** 是否已上传自定义音（实际数据存 customSound 键） */
  hasCustomSound: false,
  customSoundName: '',
};

/** 自定义音频在 storage 中的键；与 settings 分离，避免广播膨胀 */
export const CUSTOM_SOUND_KEY = 'customSound';

/** 自定义音频大小上限（字节，约 1.5MB 原始 / dataURL 更大） */
export const CUSTOM_SOUND_MAX_BYTES = 1_500_000;

/** 内置风格文案 */
export const SOUND_STYLE_LABELS = {
  default: '默认（双音）',
  chime: '清脆铃声',
  pulse: '脉冲震动',
  bell: '柔和铃',
  custom: '自定义文件',
};

export const SIT_PHASE = {
  FOCUSING: 'FOCUSING',
  BREAK_PENDING: 'BREAK_PENDING',
  BREAK_URGENT: 'BREAK_URGENT',
  RESTING: 'RESTING',
  PAUSED: 'PAUSED',
};

export const ALARM = {
  SIT_TIMER: 'SIT_TIMER',
  KEGEL_REMINDER: 'KEGEL_REMINDER',
  STORAGE_FLUSH: 'STORAGE_FLUSH',
  OFFSCREEN_CLEANUP: 'OFFSCREEN_CLEANUP',
  BADGE_BLINK: 'BADGE_BLINK',
  URGENT_NUDGE: 'URGENT_NUDGE',
};

/** Alarm 间隔（分钟）—— Sit 每分钟推进一次 */
export const SIT_TICK_MINUTES = 1;

/** 休息未响应多久进入紧急态（秒） */
export const BREAK_URGENT_AFTER_SECONDS = 2 * 60;

/** 预警提前量（秒）：剩余 1 分钟改橙色角标 */
export const WARN_BEFORE_SECONDS = 60;

/** 同一次强提醒去重冷却（秒）——避免连发，但允许周期性复响 */
export const STRONG_ALERT_COOLDOWN_SECONDS = 90;

/** 超时后重复强提醒间隔（分钟） */
export const URGENT_NUDGE_MINUTES = 2;

/** 角标闪烁间隔（分钟，约 3 秒） */
export const BADGE_BLINK_MINUTES = 0.05;

/** Storage 写入节流间隔（毫秒） */
export const STORAGE_FLUSH_MS = 10_000;

/** Offscreen 文档存活时长（毫秒）——需覆盖最长 urgent 音序 */
export const OFFSCREEN_TTL_MS = 8_000;

/** 中性化通知文案（防社死） */
export const COPY = {
  sitWarn: {
    title: '即将休息',
    message: '再坚持一会儿，约 1 分钟后起来活动一下。',
  },
  sitBreak: {
    title: '该起来走走了',
    message: '专注时段结束，起身活动一下肩颈和腿部吧。',
  },
  sitUrgent: {
    title: '休息提醒',
    message: '已经超时啦，站起来活动 1 分钟，身体会感谢你。',
  },
  sitRestStart: {
    title: '干得漂亮',
    message: '起来走走吧，休息结束后继续专注。',
  },
  sitRestDone: {
    title: '休息结束',
    message: '准备好了吗？进入下一轮专注。',
  },
  kegel: {
    title: '🌬️ 微运动',
    message: '收紧核心，保持 3 秒，然后放松。',
  },
  kegelDone: {
    title: '已记录',
    message: '一组完成，继续保持。',
  },
  phaseLabel: {
    FOCUSING: '专注中',
    BREAK_PENDING: '该休息了',
    BREAK_URGENT: '请尽快休息',
    RESTING: '休息中',
    PAUSED: '已暂停',
  },
};

export const Actions = {
  // Popup -> Background
  GET_STATE: 'GET_STATE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  PAUSE_SIT: 'PAUSE_SIT',
  RESUME_SIT: 'RESUME_SIT',
  START_BREAK: 'START_BREAK',
  SKIP_BREAK: 'SKIP_BREAK',
  DO_KEGEL_NOW: 'DO_KEGEL_NOW',
  RESET_SIT: 'RESET_SIT',
  SET_CUSTOM_SOUND: 'SET_CUSTOM_SOUND',
  CLEAR_CUSTOM_SOUND: 'CLEAR_CUSTOM_SOUND',
  PREVIEW_SOUND: 'PREVIEW_SOUND',

  // Content -> Background
  USER_ACTIVE: 'USER_ACTIVE',
  USER_IDLE: 'USER_IDLE',
  FULLSCREEN_ON: 'FULLSCREEN_ON',
  FULLSCREEN_OFF: 'FULLSCREEN_OFF',

  // Background -> Popup / Offscreen / Content
  STATE_UPDATED: 'STATE_UPDATED',
  PLAY_NOTIFY: 'PLAY_NOTIFY',
  SHOW_PAGE_BANNER: 'SHOW_PAGE_BANNER',
  HIDE_PAGE_BANNER: 'HIDE_PAGE_BANNER',

  // Content -> Background（横幅按钮）
  PAGE_BANNER_ACTION: 'PAGE_BANNER_ACTION',
};

/** 根据设置把「分钟」换算为实际秒数（DEBUG 时压缩） */
export function minutesToSeconds(minutes) {
  const secs = Math.max(1, Math.round(minutes * 60 * DEBUG_SCALE));
  return secs;
}

/** 今日日期键 YYYY-MM-DD（本地时区） */
export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

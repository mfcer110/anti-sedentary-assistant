# Architecture / 架构摘要

Bilingual quick index. Full product notes live in commit history and README.

中英文速查。完整说明见 README。

## Dual-core state machines / 双核状态机

```
SitTimer:
  FOCUSING → BREAK_PENDING → BREAK_URGENT
      ↕            ↓
   PAUSED      RESTING → FOCUSING

KegelTimer:
  Alarm due → remind → schedule next Alarm
```

## Reminder channels / 提醒通道

No system `chrome.notifications`.

不使用系统通知。

Channels used:

1. Toolbar badge blink
2. In-page reminder card (content script)
3. Offscreen alert tone
4. Optional window `drawAttention` flash

## Message protocol / 消息协议

See `src/shared/constants.js` → `Actions`:

- Popup → BG: `GET_STATE` / `UPDATE_SETTINGS` / `PAUSE_SIT` / `RESUME_SIT` / `START_BREAK` / `SKIP_BREAK` / `DO_KEGEL_NOW` / `RESET_SIT` / sound helpers
- Content → BG: `USER_ACTIVE` / `USER_IDLE` / `FULLSCREEN_ON` / `FULLSCREEN_OFF` / `PAGE_BANNER_ACTION`
- BG → Popup: `STATE_UPDATED`
- BG → Offscreen: `PLAY_NOTIFY`
- BG → Content: `SHOW_PAGE_BANNER` / `HIDE_PAGE_BANNER`

## Storage keys / 存储键

- `settings` — user config
- `state` — phase + daily stats
- `cooldown` — strong alert cooldown
- `customSound` — optional local audio data URL (separate to avoid broadcast bloat)

## Copy policy / 文案原则

Neutral wording only: “核心收紧 / micro-motion / 起来走走”. Avoid sensitive terms.

## Wall-clock sync / 墙钟同步

Opening the popup and alarm ticks share `syncSitWithWallClock()` so Service Worker sleep does not “reset” the countdown when the user reopens the extension.

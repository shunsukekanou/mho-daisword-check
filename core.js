/*
 * core.js：時刻の区切りと、保存データの読み書き（画面には触らない部分）
 *
 * ・毎日のリセット：日本時間（UTC+9）の毎朝 5:00
 * ・週1回のリセット：日本時間の毎週月曜 朝 5:00
 * ・端末のタイムゾーン設定に左右されないよう、すべて「UTC に 9 時間足した値」から計算する。
 *   （Date の getHours() などの「端末の時刻」を返す関数は使わない）
 * ・保存データには版（v）を付け、形が変わっても古いデータで壊れないようにする。
 * ブラウザでは window.MhoCore、Node（試験）では module.exports として使える。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MhoCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var JST_OFFSET_MS = 9 * HOUR;
  var RESET_HOUR = 5;

  var STORAGE_KEY = 'mho-daisword-check';
  var STATE_VERSION = 1;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // 日本時間の「壁時計」を、UTC の getter（getUTCHours など）で読める Date にする
  function jstShift(ms) { return new Date(ms + JST_OFFSET_MS); }

  function ymd(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // 毎日の区切り：日本時間 5:00 を「日の始まり」とみなし、その日付を返す
  function dailyPeriod(nowMs) {
    return ymd(jstShift(nowMs - RESET_HOUR * HOUR));
  }

  // 週の区切り：日本時間の月曜 5:00 を「週の始まり」とみなし、その月曜の日付を返す
  function weeklyPeriod(nowMs) {
    var s = jstShift(nowMs - RESET_HOUR * HOUR);
    var back = (s.getUTCDay() + 6) % 7; // 月曜からの日数（月=0 … 日=6）
    return ymd(new Date(s.getTime() - back * DAY));
  }

  // 次の毎日リセット（日本時間 5:00）の時刻（ミリ秒）。ちょうど 5:00 のときは、翌日の 5:00
  function nextDailyResetMs(nowMs) {
    var s = jstShift(nowMs);
    var todayReset = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), RESET_HOUR) - JST_OFFSET_MS;
    return nowMs < todayReset ? todayReset : todayReset + DAY;
  }

  // 次の週1回リセット（日本時間の月曜 5:00）の時刻（ミリ秒）。ちょうど月曜 5:00 のときは、翌週
  function nextWeeklyResetMs(nowMs) {
    var s = jstShift(nowMs - RESET_HOUR * HOUR);
    var back = (s.getUTCDay() + 6) % 7;
    var mondayMidnight = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - back * DAY - JST_OFFSET_MS;
    return mondayMidnight + RESET_HOUR * HOUR + 7 * DAY;
  }

  // 画面に出す文：「今日 5:00」または「明日 5:00」
  function formatNextDaily(nowMs) {
    var next = nextDailyResetMs(nowMs);
    var sameDay = ymd(jstShift(nowMs)) === ymd(jstShift(next));
    return (sameDay ? '今日' : '明日') + ' ' + RESET_HOUR + ':00';
  }

  // 画面に出す文：「次の月曜 5:00（11/30）」
  function formatNextWeekly(nowMs) {
    var d = jstShift(nextWeeklyResetMs(nowMs));
    return '次の月曜 ' + RESET_HOUR + ':00（' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '）';
  }

  function defaultState(nowMs) {
    return {
      v: STATE_VERSION,
      chapter: 1,
      daily: { period: dailyPeriod(nowMs), checks: {} },
      weekly: { period: weeklyPeriod(nowMs), checks: {} },
      roadmap: { checks: {} }
    };
  }

  // チェックの入った項目だけを取り出す（壊れたデータや余計な項目は捨てる）
  function cleanChecks(obj) {
    var out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach(function (k) {
      if (obj[k] === true && typeof k === 'string' && k.length > 0 && k.length <= 40) out[k] = true;
    });
    return out;
  }

  // 保存されていた生のデータを、今の形に直す。知らない版・壊れたデータでも、読める部分だけ使う
  function migrate(raw, nowMs) {
    var out = defaultState(nowMs);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

    if (typeof raw.chapter === 'number' && raw.chapter >= 1 && raw.chapter <= 4 && raw.chapter === Math.floor(raw.chapter)) {
      out.chapter = raw.chapter;
    }
    ['daily', 'weekly'].forEach(function (k) {
      var part = raw[k];
      if (part && typeof part === 'object' && typeof part.period === 'string' && part.period.length <= 20) {
        out[k] = { period: part.period, checks: cleanChecks(part.checks) };
      }
    });
    if (raw.roadmap && typeof raw.roadmap === 'object') {
      out.roadmap = { checks: cleanChecks(raw.roadmap.checks) };
    }
    applyResets(out, nowMs);
    return out;
  }

  // 区切りをまたいでいたら、毎日・週1回のチェックを消す（ロードマップは消さない）。変更したら true
  function applyResets(state, nowMs) {
    var changed = false;
    var dp = dailyPeriod(nowMs);
    var wp = weeklyPeriod(nowMs);
    if (state.daily.period !== dp) {
      state.daily = { period: dp, checks: {} };
      changed = true;
    }
    if (state.weekly.period !== wp) {
      state.weekly = { period: wp, checks: {} };
      changed = true;
    }
    return changed;
  }

  function loadState(storage, nowMs) {
    var raw = null;
    try {
      var text = storage.getItem(STORAGE_KEY);
      if (text) raw = JSON.parse(text);
    } catch (e) {
      raw = null;
    }
    return migrate(raw, nowMs);
  }

  function saveState(storage, state) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function countDone(items, checks) {
    var n = 0;
    items.forEach(function (it) { if (checks[it.id] === true) n += 1; });
    return n;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    STATE_VERSION: STATE_VERSION,
    dailyPeriod: dailyPeriod,
    weeklyPeriod: weeklyPeriod,
    nextDailyResetMs: nextDailyResetMs,
    nextWeeklyResetMs: nextWeeklyResetMs,
    formatNextDaily: formatNextDaily,
    formatNextWeekly: formatNextWeekly,
    defaultState: defaultState,
    migrate: migrate,
    applyResets: applyResets,
    loadState: loadState,
    saveState: saveState,
    countDone: countDone
  };
});

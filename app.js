/*
 * app.js：画面の組み立てと操作
 * ・データは端末の localStorage に保存する（ログイン・サーバー・端末間の同期はしない）
 * ・補足は「押した1か所だけ」が開く（同時に開くのは1つ）
 * ・URL の # で、開くタブを指定できる（例：#tab=weekly）。確認用に、章も指定できる（例：#tab=daily&ch=3。保存はされない）
 */
(function () {
  'use strict';

  var Core = window.MhoCore;
  var Data = window.MhoData;

  // ---------- 保存先 ----------
  var storage = (function () {
    try {
      var s = window.localStorage;
      s.setItem('__mho_probe', '1');
      s.removeItem('__mho_probe');
      return s;
    } catch (e) {
      return null; // 非公開モードなどで使えないとき
    }
  })();
  var storageOk = storage !== null;
  var state = storage ? Core.loadState(storage, Date.now()) : Core.defaultState(Date.now());

  function save() {
    if (!storage) return;
    storageOk = Core.saveState(storage, state);
  }

  // ---------- 表示の状態（保存しない） ----------
  var view = readHash();
  view.open = null;        // 開いている補足（'scope:id'）。同時に開くのは1つ
  view.armed = null;       // 手動リセットの「もう一度押すと実行」待ち（'daily' / 'weekly'）
  view.armTimer = null;
  view.copied = null;      // 直前にコピーしたコードと、成功したか
  view.copyTimer = null;

  function readHash() {
    var out = { tab: 'daily', chapterOverride: null };
    var params;
    try { params = new URLSearchParams(window.location.hash.replace(/^#/, '')); } catch (e) { return out; }
    var tab = params.get('tab');
    if (tab && Data.tabs.some(function (t) { return t.id === tab; })) out.tab = tab;
    var ch = parseInt(params.get('ch'), 10);
    if (ch >= 1 && ch <= 4) out.chapterOverride = ch;
    return out;
  }

  function currentChapter() {
    return view.chapterOverride !== null ? view.chapterOverride : state.chapter;
  }

  // ---------- 小さな道具 ----------
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function tabName(id) {
    for (var i = 0; i < Data.tabs.length; i++) if (Data.tabs[i].id === id) return Data.tabs[i].name;
    return '';
  }

  // ---------- 固定部分（上の章ボタン・下のタブ）の用意 ----------
  var chip = document.getElementById('tab-chip');
  var chapterBox = document.getElementById('chapter-buttons');
  var nav = document.getElementById('nav');
  var main = document.getElementById('main');

  Data.chapters.forEach(function (c) {
    var b = el('button', '', c.label);
    b.type = 'button';
    b.dataset.ch = String(c.n);
    b.addEventListener('click', function () {
      state.chapter = c.n;
      view.chapterOverride = null;
      view.open = null;
      save();
      render();
    });
    chapterBox.appendChild(b);
  });

  Data.tabs.forEach(function (t) {
    var b = el('button', '', t.name);
    b.type = 'button';
    b.dataset.tab = t.id;
    b.addEventListener('click', function () { goTab(t.id); });
    nav.appendChild(b);
  });

  function goTab(id) {
    view.tab = id;
    view.open = null;
    try { window.history.replaceState(null, '', '#tab=' + id); } catch (e) { /* 何もしない */ }
    window.scrollTo(0, 0);
    render();
  }

  // ---------- 行の部品 ----------
  function toggleOpen(key) {
    view.open = view.open === key ? null : key;
    renderKeepScroll();
  }

  // 補足つきのチェック行。opts: { scope, id, title, note, checked, locked, minCh, road, onToggle }
  function makeRow(opts) {
    var key = opts.scope + ':' + opts.id;
    var isOpen = view.open === key;
    var row = el('div', 'row' + (opts.checked ? ' done' : '') + (opts.locked ? ' locked' : '') + (opts.road ? ' road' : ''));
    var mainRow = el('div', 'row-main');

    var title = el('button', 'row-title' + (opts.noCheck ? ' pad' : ''));
    title.type = 'button';
    title.appendChild(document.createTextNode(opts.title));
    if (opts.locked) {
      title.appendChild(el('span', 'badge', '【' + opts.minCh + '章で解放】'));
    }
    title.addEventListener('click', opts.noCheck ? function () { toggleOpen(key); } : opts.onToggle);

    if (!opts.noCheck) {
      var chk = el('button', 'check');
      chk.type = 'button';
      chk.setAttribute('role', 'checkbox');
      chk.setAttribute('aria-checked', opts.checked ? 'true' : 'false');
      chk.setAttribute('aria-label', opts.title);
      chk.appendChild(el('span', 'box', opts.checked ? '✓' : ''));
      chk.addEventListener('click', opts.onToggle);
      mainRow.appendChild(chk);
    }
    mainRow.appendChild(title);

    if (opts.note) {
      var more = el('button', 'more', isOpen ? '補足▲' : '補足▼');
      more.type = 'button';
      more.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      more.addEventListener('click', function () { toggleOpen(key); });
      mainRow.appendChild(more);
    }
    row.appendChild(mainRow);

    if (opts.note && isOpen) {
      row.appendChild(el('p', 'note' + (opts.noCheck ? ' flush' : ''), opts.note));
    }
    return row;
  }

  function summaryCard(label, done, total, resetText) {
    var box = el('div', 'summary');
    var count = el('span', 'count', label);
    count.appendChild(el('b', '', done + ' / ' + total));
    box.appendChild(count);
    box.appendChild(el('span', 'reset', '次回リセット：' + resetText));
    var bar = el('div', 'bar');
    var fill = el('span');
    fill.style.width = (total ? Math.round(done * 100 / total) : 0) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    return box;
  }

  function warnBox() {
    return el('p', 'warn', 'この端末（ブラウザ）では、チェックを保存できません。非公開モードの場合は、通常のウィンドウで開いてください。');
  }

  // ---------- 毎日／週1回 ----------
  function renderChecklist(scope, items, label, resetText) {
    var frag = document.createDocumentFragment();
    var checks = state[scope].checks;
    var ch = currentChapter();
    var done = Core.countDone(items, checks);

    if (!storageOk) frag.appendChild(warnBox());
    frag.appendChild(summaryCard(label, done, items.length, resetText));

    // 解放済みを上に、未解放を下に（それぞれ元の順番を保つ）
    var unlocked = items.filter(function (it) { return it.minCh <= ch; });
    var locked = items.filter(function (it) { return it.minCh > ch; });
    unlocked.concat(locked).forEach(function (it) {
      frag.appendChild(makeRow({
        scope: scope, id: it.id, title: it.title, note: it.note,
        checked: checks[it.id] === true, locked: it.minCh > ch, minCh: it.minCh,
        onToggle: function () {
          if (checks[it.id] === true) delete checks[it.id]; else checks[it.id] = true;
          save();
          renderKeepScroll();
        }
      }));
    });
    return frag;
  }

  // ---------- ロードマップ ----------
  function renderRoadmap() {
    var frag = document.createDocumentFragment();
    var checks = state.roadmap.checks;
    var total = 0, done = 0;
    Data.roadmap.forEach(function (b) {
      b.items.forEach(function (it) { total += 1; if (checks[it.id] === true) done += 1; });
    });

    if (!storageOk) frag.appendChild(warnBox());
    var sum = summaryCard('全体の完了数', done, total, 'なし（進み具合はずっと保存されます）');
    frag.appendChild(sum);

    Data.roadmap.forEach(function (b) {
      var d = Core.countDone(b.items, checks);
      var head = el('div', 'block-head');
      head.appendChild(el('h2', '', b.title));
      head.appendChild(el('span', 'n', d + ' / ' + b.items.length));
      frag.appendChild(head);
      if (b.hint) frag.appendChild(el('p', 'sec-hint', b.hint));
      b.items.forEach(function (it) {
        frag.appendChild(makeRow({
          scope: 'roadmap', id: it.id, title: it.text, note: '', road: true,
          checked: checks[it.id] === true, locked: false, minCh: 1,
          onToggle: function () {
            if (checks[it.id] === true) delete checks[it.id]; else checks[it.id] = true;
            save();
            renderKeepScroll();
          }
        }));
      });
    });
    return frag;
  }

  // ---------- ルール ----------
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function disarm() {
    view.armed = null;
    if (view.armTimer) { clearTimeout(view.armTimer); view.armTimer = null; }
  }

  function resetButton(scope, label) {
    var armed = view.armed === scope;
    var b = el('button', 'btn wide' + (armed ? ' armed' : ''), armed ? 'もう一度押すと、リセットします' : label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (view.armed === scope) {
        disarm();
        var now = Date.now();
        state[scope] = {
          period: scope === 'daily' ? Core.dailyPeriod(now) : Core.weeklyPeriod(now),
          checks: {}
        };
        save();
        renderKeepScroll();
      } else {
        disarm();
        view.armed = scope;
        view.armTimer = setTimeout(function () { disarm(); renderKeepScroll(); }, 6000);
        renderKeepScroll();
      }
    });
    return b;
  }

  function renderRules() {
    var frag = document.createDocumentFragment();
    if (!storageOk) frag.appendChild(warnBox());

    // シリアルコード
    frag.appendChild(el('h2', 'sec-title', 'シリアルコード'));
    var card = el('div', 'card');
    card.appendChild(el('p', '', '※有効期限は未確認です。使えない場合があります。「できません」と出たときは、コードを長押しして、コピーしてください。'));
    Data.codes.forEach(function (code) {
      var r = el('div', 'code-row');
      r.appendChild(el('span', 'code', code));
      var state2 = view.copied && view.copied.code === code ? view.copied : null;
      var label = !state2 ? 'コピー' : (state2.ok ? 'コピーしました' : 'できません');
      var b = el('button', 'btn' + (state2 ? ' copied' : ''), label);
      b.type = 'button';
      b.setAttribute('aria-label', code + ' をコピー');
      b.addEventListener('click', function () {
        copyText(code, function (ok) {
          view.copied = { code: code, ok: ok };
          if (view.copyTimer) clearTimeout(view.copyTimer);
          view.copyTimer = setTimeout(function () { view.copied = null; renderKeepScroll(); }, 2200);
          renderKeepScroll();
        });
      });
      r.appendChild(b);
      card.appendChild(r);
    });
    frag.appendChild(card);

    // 育成ルール
    frag.appendChild(el('h2', 'sec-title', '迷わない育成ルール'));
    frag.appendChild(el('p', 'sec-hint', '「補足」を押すと、理由が開きます（開くのは1つずつ）。'));
    Data.rules.forEach(function (r) {
      // ルールの行は、チェックの記録はしない。タップすると補足が開く
      frag.appendChild(makeRow({
        scope: 'rules', id: r.id, title: r.title, note: r.note,
        checked: false, locked: false, minCh: 1, road: true, noCheck: true,
        onToggle: function () { toggleOpen('rules:' + r.id); }
      }));
    });

    // 手動リセット
    frag.appendChild(el('h2', 'sec-title', '手動リセット'));
    var rc = el('div', 'card');
    rc.appendChild(el('p', '', '毎日・週1回は、日本時間の朝5:00に自動でリセットされます。やり直したいときだけ使います。ロードマップは消えません。'));
    rc.appendChild(resetButton('daily', '毎日チェックを手動リセット'));
    rc.appendChild(resetButton('weekly', '週1回チェックを手動リセット'));
    frag.appendChild(rc);

    // 注意書き
    var note = el('div', 'card');
    note.appendChild(el('p', '', '内容は、攻略サイトと個人の投稿をもとにした整理です。ゲームの更新で変わることがあります。ゲーム内の表示を優先してください。'));
    note.appendChild(el('p', '', 'チェックの記録は、この端末のブラウザの中だけに保存されます。ほかの端末とは共有されません。'));
    frag.appendChild(note);
    frag.appendChild(el('p', 'foot', 'MHO 大剣 毎日チェック'));
    return frag;
  }

  // ---------- 全体の描画 ----------
  function render() {
    var ch = currentChapter();
    chip.textContent = tabName(view.tab);
    Array.prototype.forEach.call(chapterBox.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.ch) === String(ch) ? 'true' : 'false');
    });
    Array.prototype.forEach.call(nav.children, function (b) {
      if (b.dataset.tab === view.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });

    var now = Date.now();
    main.textContent = '';
    if (view.tab === 'daily') {
      main.appendChild(renderChecklist('daily', Data.daily, '今日の完了数', Core.formatNextDaily(now)));
    } else if (view.tab === 'weekly') {
      main.appendChild(renderChecklist('weekly', Data.weekly, '今週の完了数', Core.formatNextWeekly(now)));
    } else if (view.tab === 'roadmap') {
      main.appendChild(renderRoadmap());
    } else {
      main.appendChild(renderRules());
    }
    lastKey = resetKey(now);
  }

  function renderKeepScroll() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ---------- 自動リセット（開いたまま 5:00 をまたいだときも反映） ----------
  var lastKey = '';
  function resetKey(now) {
    return [Core.dailyPeriod(now), Core.weeklyPeriod(now), Core.formatNextDaily(now), Core.formatNextWeekly(now)].join('|');
  }

  function tick() {
    var now = Date.now();
    var changed = Core.applyResets(state, now);
    if (changed) save();
    if (changed || resetKey(now) !== lastKey) renderKeepScroll();
  }

  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('focus', tick);
  window.addEventListener('pageshow', tick);

  // 保存した直後の状態にも区切りを反映してから最初の描画をする
  if (Core.applyResets(state, Date.now())) save();
  render();

  // ---------- ホーム画面に追加できるようにする（オフラインでも開ける） ----------
  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても、アプリは普通に動く */ });
    });
  }
})();

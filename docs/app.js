(() => {
  'use strict';

  // ---------- 保存（このスマホの中だけ） ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mn:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mn:' + k, JSON.stringify(v)); } catch {} },
  };
  const readIds = new Set(store.get('read', []));
  let saved = store.get('saved', []);
  const readDays = new Set(store.get('days', []));

  const $ = (s) => document.querySelector(s);
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SLOTS = [
    { id: 'am', label: '朝', sub: 'けさ', emoji: '☀️' },
    { id: 'noon', label: '昼', sub: 'おひる', emoji: '🍙' },
    { id: 'pm', label: '夜', sub: 'こんばん', emoji: '🌙' },
  ];
  const DEFAULT_CATS = [
    { id: 'saitama', name: '埼玉', emoji: '📍' }, { id: 'politics', name: '政治', emoji: '🏛️' },
    { id: 'economy', name: '経済', emoji: '💴' }, { id: 'world', name: '国際', emoji: '🌏' },
    { id: 'society', name: '社会', emoji: '🏙️' }, { id: 'life', name: 'くらし', emoji: '🛒' },
    { id: 'business', name: 'ビジネス', emoji: '💼' }, { id: 'science', name: '科学・IT', emoji: '🔬' },
  ];

  let index = [];
  let edition = null;
  let cats = DEFAULT_CATS;
  let filter = 'all';
  let view = 'home';

  const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  function fmtDate(d) {
    const [y, m, day] = d.split('-').map(Number);
    const w = wd[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
    return `${m}月${day}日（${w}）`;
  }
  function ago(iso) {
    if (!iso) return '';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 60) return `${Math.max(1, m)}分前`;
    if (m < 60 * 24) return `${Math.round(m / 60)}時間前`;
    return `${Math.round(m / 1440)}日前`;
  }
  function catOf(id) { return cats.find((c) => c.id === id) || { id, name: id, emoji: '📰' }; }

  // ---------- データ読み込み ----------
  async function getJSON(url) {
    const res = await fetch(url + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  async function loadIndex() {
    try { index = await getJSON('data/index.json'); } catch { index = []; }
  }
  async function openEdition(id, { scroll = true } = {}) {
    $('#list').innerHTML = '<div class="skeleton"></div>'.repeat(4);
    try {
      edition = await getJSON(`data/editions/${id}.json`);
      cats = edition.categories?.length ? edition.categories : DEFAULT_CATS;
      store.set('last', id);
    } catch {
      edition = null;
    }
    filter = 'all';
    renderAll();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- 描画 ----------
  function renderHeader() {
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    $('#greet').textContent = h < 5 ? 'こんばんは 🌙' : h < 11 ? 'おはようございます ☀️' : h < 17 ? 'こんにちは 🌤️' : 'こんばんは 🌙';
    const date = edition?.date || todayJst();
    $('#date-text').textContent = fmtDate(date);
    const dates = editionDates();
    const i = dates.indexOf(date);
    $('#prev-day').disabled = i < 0 || i >= dates.length - 1;
    $('#next-day').disabled = i <= 0;
    $('#slots').innerHTML = SLOTS.map((s) => {
      const e = index.find((x) => x.date === date && x.slot === s.id);
      const on = edition && edition.slot === s.id && edition.date === date;
      const t = e ? new Date(e.generatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : 'まだ';
      return `<button class="slot${on ? ' on' : ''}" role="tab" aria-selected="${on}" ${e ? `data-id="${e.id}"` : 'disabled'}>${s.emoji} ${s.label}<small>${t}${e ? ' 更新' : ''}</small></button>`;
    }).join('');
    const s = streak();
    $('#streak').textContent = s >= 1 ? `🔥 ${s}日つづけて読んでます` : '';
  }

  function streak() {
    let n = 0;
    const d = new Date(todayJst() + 'T00:00:00Z');
    if (!readDays.has(todayJst())) d.setUTCDate(d.getUTCDate() - 1);
    while (readDays.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
    return n;
  }

  function renderProgress() {
    const items = edition?.items || [];
    const done = items.filter((i) => readIds.has(i.id)).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    $('#progress-text').textContent = `この号は ${done} / ${items.length} 本 読みました`;
    const badge = done === 0 ? '' : done >= items.length ? '🏆 ぜんぶ読んだ！' : done >= 10 ? '🎓 ものしり' : done >= 3 ? '🌱 いい調子' : '👏';
    $('#progress-badge').textContent = badge;
    $('#progress-bar').style.width = pct + '%';
  }

  function cardHTML(it) {
    const c = catOf(it.category);
    const read = readIds.has(it.id);
    const isSaved = saved.some((s) => s.id === it.id);
    return `<button class="card${read ? ' read' : ''}" data-cat="${esc(it.category)}" data-id="${esc(it.id)}">
      ${isSaved ? '<span class="star">⭐</span>' : ''}
      <div class="meta"><span class="tag">${it.emoji || c.emoji} ${esc(c.name)}</span>${it.buzz >= 4 ? '<span class="tag hot">🔥 話題</span>' : ''}</div>
      <h3>${esc(it.title)}</h3>
      ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : it.desc ? `<p class="sum lead">${esc(it.desc)}</p>` : ''}
      <div class="meta"><span>${esc(it.source)}</span><span>${ago(it.time)}</span>${it.talk ? '<span>💬 話のネタあり</span>' : ''}</div>
    </button>`;
  }

  function renderHome() {
    const items = edition?.items || [];
    if (edition?.intro) {
      $('#intro').hidden = false;
      $('#intro-text').textContent = edition.intro;
    } else {
      $('#intro').hidden = true;
    }
    if (!edition) {
      $('#hero').innerHTML = '';
      $('#chips').innerHTML = '';
      $('#list').innerHTML = `<div class="empty"><b>🗞️</b>まだニュースが届いていません。<br>朝・昼・夜に自動で届きます。</div>`;
      return;
    }
    const top = items.filter((i) => i.top);
    $('#hero').innerHTML = top.map((it, n) => {
      const c = catOf(it.category);
      return `<button class="hero-card${readIds.has(it.id) ? ' read' : ''}" data-cat="${esc(it.category)}" data-id="${esc(it.id)}">
        <span class="rank">${n + 1}</span>
        <div><span class="tag">${it.emoji || c.emoji} ${esc(c.name)}</span></div>
        <h3>${esc(it.title)}</h3>
        ${it.summary || it.desc ? `<p>${esc(it.summary || it.desc)}</p>` : ''}
        <div class="meta"><span>${esc(it.source)}</span><span>${ago(it.time)}</span>${readIds.has(it.id) ? '<span>✓ 読んだ</span>' : ''}</div>
      </button>`;
    }).join('');

    const present = cats.filter((c) => c.id !== 'saitama' && items.some((i) => i.category === c.id));
    $('#chips').innerHTML = `<button class="chip${filter === 'all' ? ' on' : ''}" data-filter="all">すべて</button>` +
      present.map((c) => `<button class="chip${filter === c.id ? ' on' : ''}" data-cat="${c.id}" data-filter="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('');

    // カテゴリごとのページを横に並べる（記事一覧を左右にめくって移動）
    const section = (c) => {
      const list = items.filter((i) => i.category === c.id);
      const done = list.filter((i) => readIds.has(i.id)).length;
      return `<div class="cat-head" data-cat="${c.id}"><span class="dot">${c.emoji}</span>${esc(c.name)}<span class="count">${done}/${list.length}</span></div>` +
        list.map(cardHTML).join('');
    };
    const pages = [{ id: 'all', html: present.map(section).join('') }, ...present.map((c) => ({ id: c.id, html: section(c) }))];
    const hint = store.get('swiped', false) ? '' : '<p class="swipe-hint" id="swipe-hint">👈 記事を左右にめくるとカテゴリを移動できます 👉</p>';
    $('#list').innerHTML = hint + `<div class="pager" id="pager">${pages.map((pg) => `<section class="page" data-page="${pg.id}">${pg.html}</section>`).join('')}</div>`;
    if (!filterOrder().includes(filter)) filter = 'all';
    syncPager(false);
  }

  function renderLocal() {
    const items = (edition?.items || []).filter((i) => i.category === 'saitama');
    $('#local-list').innerHTML = items.length
      ? items.map(cardHTML).join('')
      : `<div class="empty"><b>🍠</b>この号には埼玉のニュースがありませんでした</div>`;
  }

  function renderSaved() {
    $('#saved-list').innerHTML = saved.length
      ? saved.map(cardHTML).join('')
      : `<div class="empty"><b>⭐</b>気になった記事は、詳細画面の「保存」でここに残せます</div>`;
  }

  function renderPast() {
    const byDate = new Map();
    for (const e of index) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    if (!byDate.size) {
      $('#past-list').innerHTML = `<div class="empty"><b>📚</b>まだ過去の号はありません</div>`;
      return;
    }
    $('#past-list').innerHTML = [...byDate].map(([date, eds]) => `<div class="day"><h3>${fmtDate(date)}${date === todayJst() ? '・きょう' : ''}</h3><div class="day-row">` +
      SLOTS.map((s) => {
        const e = eds.find((x) => x.slot === s.id);
        return e
          ? `<button data-id="${e.id}">${s.emoji} ${s.label}<small>${e.count}本</small></button>`
          : `<button disabled style="opacity:.35">${s.emoji} ${s.label}<small>—</small></button>`;
      }).join('') + '</div></div>').join('');
  }

  function renderAll() {
    renderHeader();
    renderProgress();
    renderHome();
    renderLocal();
    renderSaved();
    renderPast();
  }

  // ---------- 詳細シート ----------
  function findItem(id) {
    return (edition?.items || []).find((i) => i.id === id) || saved.find((i) => i.id === id);
  }
  function openSheet(id) {
    const it = findItem(id);
    if (!it) return;
    const c = catOf(it.category);
    const isSaved = saved.some((s) => s.id === it.id);
    const body = [];
    body.push(`<div class="meta" data-cat="${esc(it.category)}"><span class="tag">${it.emoji || c.emoji} ${esc(c.name)}</span><span>${esc(it.source)}</span><span>${ago(it.time)}</span></div>`);
    body.push(`<h2>${esc(it.title)}</h2>`);
    if (it.summary) body.push(`<div class="box"><div class="lbl">📝 要約</div><p>${esc(it.summary)}</p></div>`);
    if (it.points?.length) body.push(`<div class="box"><div class="lbl">📌 ポイント</div><ul>${it.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`);
    if (!it.summary && it.desc) body.push(`<div class="box"><div class="lbl">📰 記事の書き出し</div><p>${esc(it.desc)}</p></div>`);
    if (it.why) body.push(`<div class="box why"><div class="lbl">🤔 わたしたちとの関係</div><p>${esc(it.why)}</p></div>`);
    if (it.talk) body.push(`<div class="box talk"><div class="lbl">💬 会話で使うなら <button class="copy" data-copy="${esc(it.talk)}">コピー</button></div><p>「${esc(it.talk)}」</p></div>`);
    if (it.term) body.push(`<div class="box term"><div class="lbl">📖 ことば</div><p><b>${esc(it.term.word)}</b>：${esc(it.term.meaning)}</p></div>`);
    if (!it.summary && !it.desc) body.push(`<p class="noai">くわしくは記事を開いてみてください。</p>`);
    body.push(`<div class="actions">
      <button class="btn" data-save="${esc(it.id)}">${isSaved ? '⭐ 保存ずみ' : '☆ 保存'}</button>
      <a class="btn primary" href="${esc(it.link)}" target="_blank" rel="noopener">記事を読む →</a>
    </div>`);
    $('#sheet-body').innerHTML = body.join('');
    $('#sheet').hidden = false;
    $('#backdrop').hidden = false;
    $('#sheet').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    markRead(it.id);
  }
  // シートを下へシュッとすべらせて閉じる
  let sheetClosing = false;
  // v: 指で払ったときの下向きの速さ（px/ms）。その勢いを引き継いで、最後は加速して下に吸い込まれるように消える
  function closeSheet(v = 0) {
    const sheet = $('#sheet');
    const backdrop = $('#backdrop');
    if (sheet.hidden || sheetClosing) return;
    sheetClosing = true;
    const now = new DOMMatrix(getComputedStyle(sheet).transform).m42 || 0; // いま下にずれている量
    const remaining = sheet.offsetHeight + 40 - now;
    let dur;
    let ease;
    if (v > 0.2) {
      // 払ったとき：指の速さで滑り出し、さらに加速して消える
      dur = Math.min(260, Math.max(150, remaining / Math.max(v * 1.3, 1.5)));
      const startSlope = Math.min(1.5, (v * dur) / remaining);
      ease = `cubic-bezier(.25, ${(0.25 * startSlope).toFixed(2)}, .7, .55)`;
    } else {
      // ボタンや背景タップ、ゆっくり引いたとき：少しためてから加速して落ちる
      dur = 280;
      ease = 'cubic-bezier(.5, 0, .75, .35)';
    }
    sheet.style.transition = `transform ${dur}ms ${ease}`;
    sheet.style.transform = 'translateY(calc(100% + 40px))';
    backdrop.style.transition = `opacity ${dur}ms ease-in`;
    backdrop.style.opacity = '0';
    document.body.style.overflow = '';
    setTimeout(() => {
      sheet.hidden = true;
      backdrop.hidden = true;
      sheet.style.transition = sheet.style.transform = '';
      backdrop.style.transition = backdrop.style.opacity = '';
      sheetClosing = false;
    }, dur + 20);
  }

  function markRead(id) {
    if (readIds.has(id)) return;
    readIds.add(id);
    store.set('read', [...readIds].slice(-3000));
    const firstToday = !readDays.has(todayJst());
    readDays.add(todayJst());
    store.set('days', [...readDays].slice(-400));

    const items = edition?.items || [];
    const top = items.filter((i) => i.top);
    const done = items.filter((i) => readIds.has(i.id)).length;
    if (top.length && top.some((t) => t.id === id) && top.every((t) => readIds.has(t.id))) {
      celebrate('いちばんの話題、ぜんぶチェック！🎉');
    } else if (items.length && done === items.length) {
      celebrate('この号ぜんぶ読みました！すごい！🏆');
    } else if (firstToday && streak() >= 2) {
      toast(`🔥 ${streak()}日連続！`);
    }
    setTimeout(() => { renderHeader(); renderProgress(); renderHome(); renderLocal(); renderSaved(); }, 250);
  }

  function toggleSave(id) {
    const it = findItem(id);
    if (!it) return;
    if (saved.some((s) => s.id === id)) {
      saved = saved.filter((s) => s.id !== id);
      toast('保存をやめました');
    } else {
      saved.unshift(it);
      toast('⭐ 保存しました');
    }
    store.set('saved', saved.slice(0, 200));
    openSheet(id);
    renderHome(); renderLocal(); renderSaved();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }
  function celebrate(msg) {
    toast(msg);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const marks = ['🎉', '✨', '🌸', '⭐', '🎊'];
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.textContent = marks[i % marks.length];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.animationDelay = Math.random() * 0.5 + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    }
  }

  // ---------- 画面切り替え ----------
  function show(v) {
    view = v;
    for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'view-' + v;
    for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.view === v);
    if (v === 'home') syncPager(false);
    window.scrollTo({ top: 0 });
  }

  // ---------- 操作 ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, .sheet-backdrop');
    if (!t) return;
    if (t.id === 'backdrop' || t.id === 'close') return closeSheet();
    if (t.dataset.copy) {
      try { await navigator.clipboard.writeText(t.dataset.copy); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
      return;
    }
    if (t.id === 'date') return openCalendar((edition?.date || todayJst()).slice(0, 7));
    if (t.id === 'prev-day') return goDay(-1);
    if (t.id === 'next-day') return goDay(1);
    if (t.dataset.calMonth) return openCalendar(t.dataset.calMonth);
    if (t.dataset.day) { await openDay(t.dataset.day); return closeSheet(); }
    if (t.dataset.save) return toggleSave(t.dataset.save);
    if (t.dataset.view) return show(t.dataset.view);
    if (t.dataset.filter) {
      setFilter(t.dataset.filter);
      return;
    }
    if (t.classList.contains('slot') && t.dataset.id) return openEdition(t.dataset.id);
    if (t.closest('#past-list') && t.dataset.id) { await openEdition(t.dataset.id); return show('home'); }
    if ((t.classList.contains('card') || t.classList.contains('hero-card')) && t.dataset.id) return openSheet(t.dataset.id);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ---------- 日付の移動（前後の日・カレンダー） ----------
  // 号がある日付（新しい順）
  function editionDates() {
    return [...new Set(index.map((e) => e.date))].sort().reverse();
  }
  // その日の号を開く（いま見ている朝・昼・夜と同じ号があればそれ、無ければその日のいちばん新しい号）
  async function openDay(date, dir = 0) {
    const eds = index.filter((e) => e.date === date);
    if (!eds.length) return;
    const pick = eds.find((e) => e.slot === edition?.slot) || eds.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    await openEdition(pick.id, { scroll: false });
    window.scrollTo({ top: 0 });
    show('home');
    const d = $('#date-text');
    d.classList.remove('slide-l', 'slide-r');
    void d.offsetWidth;
    if (dir) d.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
  }
  // dir: -1 = 前の日（古い）、1 = 次の日（新しい）
  async function goDay(dir) {
    const dates = editionDates();
    const i = dates.indexOf(edition?.date);
    const next = dates[i - dir];
    if (i < 0 || !next) { toast(dir < 0 ? 'これより前の号はありません' : 'これが最新の号です'); return; }
    await openDay(next, dir);
  }
  // 日付のあたりを左右にスワイプして前後の日へ（右へ払う＝前の日）
  let daySwipe = null;
  $('.top').addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    daySwipe = e.touches.length === 1 && t.clientX > 16 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  $('.top').addEventListener('touchend', (e) => {
    if (!daySwipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - daySwipe.x;
    const dy = t.clientY - daySwipe.y;
    daySwipe = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    goDay(dx > 0 ? -1 : 1);
  }, { passive: true });

  // カレンダー（記事詳細と同じ、下から出るシートに表示）
  function openCalendar(month) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const months = [...new Set(index.map((e) => e.date.slice(0, 7)))].sort();
    const prevM = months.filter((x) => x < month).pop();
    const nextM = months.find((x) => x > month);
    const cur = edition?.date;
    const today = todayJst();
    const cells = [];
    for (let k = 0; k < lead; k++) cells.push('<span class="cal-cell empty"></span>');
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const eds = index.filter((e) => e.date === date);
      const dots = SLOTS.map((s) => `<i class="${eds.some((e) => e.slot === s.id) ? 'on' : ''}"></i>`).join('');
      const cls = ['cal-cell', date === cur ? 'sel' : '', date === today ? 'today' : '', readDays.has(date) ? 'read' : '', eds.length ? '' : 'none'].join(' ');
      cells.push(eds.length
        ? `<button class="${cls}" data-day="${date}"><b>${d}</b><span class="dots">${dots}</span></button>`
        : `<span class="${cls}"><b>${d}</b></span>`);
    }
    const html = `<div class="cal" id="cal" data-month="${month}">
      <div class="cal-head">
        <button class="cal-nav" ${prevM ? `data-cal-month="${prevM}"` : 'disabled'} aria-label="前の月">‹</button>
        <h2>${y}年${m}月</h2>
        <button class="cal-nav" ${nextM ? `data-cal-month="${nextM}"` : 'disabled'} aria-label="次の月">›</button>
      </div>
      <div class="cal-week">${wd.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <p class="cal-note"><i class="on"></i> 号がある日（点は朝・昼・夜）　<span class="cal-read-mark"></span> 読んだ日</p>
    </div>`;
    const sheet = $('#sheet');
    const wasOpen = !sheet.hidden;
    $('#sheet-body').innerHTML = html;
    if (!wasOpen) {
      sheet.hidden = false;
      $('#backdrop').hidden = false;
      sheet.scrollTop = 0;
      document.body.style.overflow = 'hidden';
    }
  }
  // カレンダーを左右にスワイプして月を移動
  let calSwipe = null;
  $('#sheet').addEventListener('touchstart', (e) => {
    calSwipe = e.target.closest('#cal') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  $('#sheet').addEventListener('touchend', (e) => {
    if (!calSwipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - calSwipe.x;
    const dy = t.clientY - calSwipe.y;
    calSwipe = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const btn = document.querySelectorAll('#cal .cal-nav')[dx > 0 ? 0 : 1];
    if (btn?.dataset.calMonth) openCalendar(btn.dataset.calMonth);
  }, { passive: true });

  // ---------- 記事一覧を左右にめくってカテゴリを移動 ----------
  function filterOrder() {
    const items = edition?.items || [];
    return ['all', ...cats.filter((c) => c.id !== 'saitama' && items.some((i) => i.category === c.id)).map((c) => c.id)];
  }
  // いま表示しているページに合わせて、ボタンの色・ページの高さ・めくり位置をそろえる
  let pagerLock = false;
  function syncPager(smooth) {
    const pager = $('#pager');
    if (!pager) return;
    const idx = Math.max(0, filterOrder().indexOf(filter));
    const page = pager.children[idx];
    if (page) pager.style.height = page.offsetHeight + 'px';
    const left = idx * pager.clientWidth;
    if (Math.abs(pager.scrollLeft - left) > 2) {
      pagerLock = true;
      pager.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
      setTimeout(() => { pagerLock = false; }, smooth ? 450 : 50);
    }
    for (const b of document.querySelectorAll('#chips .chip')) b.classList.toggle('on', b.dataset.filter === filter);
    const chips = $('#chips');
    const chip = chips.querySelector(`[data-filter="${filter}"]`);
    if (chip) chips.scrollTo({ left: chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }
  // 下までスクロールしていたら、新しいカテゴリの先頭が見える位置まで戻す
  function scrollToPagerTop() {
    const pager = $('#pager');
    if (!pager) return;
    const chipsBottom = $('#chips').getBoundingClientRect().bottom;
    const top = pager.getBoundingClientRect().top;
    if (top < chipsBottom) window.scrollTo({ top: window.scrollY + top - chipsBottom - 4 });
  }
  function setFilter(next) {
    if (next === filter) return;
    filter = next;
    syncPager(true);
    scrollToPagerTop();
  }
  // 指でめくり終わったら、そのページのカテゴリに切り替える
  let pagerTimer;
  document.addEventListener('scroll', (e) => {
    const pager = e.target;
    if (!(pager instanceof Element) || pager.id !== 'pager' || pagerLock) return;
    clearTimeout(pagerTimer);
    pagerTimer = setTimeout(() => {
      const idx = Math.round(pager.scrollLeft / pager.clientWidth);
      const next = filterOrder()[idx];
      if (!next || next === filter) return;
      filter = next;
      syncPager(false);
      scrollToPagerTop();
      store.set('swiped', true);
      $('#swipe-hint')?.remove();
    }, 120);
  }, true);
  window.addEventListener('resize', () => syncPager(false));
  document.fonts?.ready.then(() => syncPager(false));

  // シートを指で下に引っぱって閉じる（指に合わせて動き、離すとシュッと閉じるか元に戻る）
  const sheetEl = $('#sheet');
  const backdropEl = $('#backdrop');
  let pull = null;
  sheetEl.addEventListener('touchstart', (e) => {
    if (sheetClosing || e.touches.length > 1) { pull = null; return; }
    const y = e.touches[0].clientY;
    pull = { x: e.touches[0].clientX, y, samples: [[performance.now(), y]], dy: 0, active: false, atTop: sheetEl.scrollTop <= 0 };
  }, { passive: true });
  sheetEl.addEventListener('touchmove', (e) => {
    if (!pull) return;
    const y = e.touches[0].clientY;
    if (!pull.active) {
      const dy = y - pull.y;
      if (Math.abs(dy) < 6) return;
      // いちばん上で下に引いたときだけシートを動かす。それ以外は中身のスクロール
      const dx = e.touches[0].clientX - pull.x;
      if (dy > 0 && dy > Math.abs(dx) && pull.atTop && sheetEl.scrollTop <= 0) pull.active = true;
      else { pull = null; return; }
    }
    e.preventDefault();
    const now = performance.now();
    pull.samples.push([now, y]);
    while (pull.samples.length > 2 && now - pull.samples[0][0] > 100) pull.samples.shift(); // 直前0.1秒ぶんだけ残す
    pull.dy = Math.max(0, y - pull.y);
    sheetEl.style.transition = 'none';
    sheetEl.style.transform = `translateY(${pull.dy}px)`;
    backdropEl.style.transition = 'none';
    backdropEl.style.opacity = String(Math.max(0, 1 - pull.dy / (sheetEl.offsetHeight || 600)));
  }, { passive: false });
  const endPull = () => {
    if (!pull) return;
    const { active, dy, samples } = pull;
    pull = null;
    if (!active) return;
    // 直前0.1秒の下向きの速さ（px/ms）
    const [t1, y1] = samples[0];
    const [t2, y2] = samples[samples.length - 1];
    const v = (y2 - y1) / Math.max(16, t2 - t1);
    // ある程度引いたか、下に払ったら閉じる。少しだけなら元に戻す
    if (dy > 80 || (v > 0.3 && dy > 20) || dy > sheetEl.offsetHeight * 0.25) {
      closeSheet(Math.max(v, 0));
    } else {
      sheetEl.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1.15)';
      sheetEl.style.transform = '';
      backdropEl.style.transition = 'opacity .28s ease';
      backdropEl.style.opacity = '';
      setTimeout(() => { if (!pull) { sheetEl.style.transition = ''; backdropEl.style.transition = ''; } }, 300);
    }
  };
  sheetEl.addEventListener('touchend', endPull, { passive: true });
  sheetEl.addEventListener('touchcancel', endPull, { passive: true });

  // アプリに戻ってきたら新しい号を確認
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const before = index[0]?.id;
    await loadIndex();
    if (index[0] && index[0].id !== before) {
      toast('🆕 新しいニュースが届きました');
      await openEdition(index[0].id, { scroll: false });
    } else renderHeader();
  });

  // ---------- 起動 ----------
  (async () => {
    await loadIndex();
    const latest = index[0]?.id;
    if (latest) await openEdition(latest, { scroll: false });
    else renderAll();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();

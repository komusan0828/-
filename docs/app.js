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
    $('#date').textContent = fmtDate(date);
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

    const groups = (filter === 'all' ? present : present.filter((c) => c.id === filter));
    const hint = store.get('swiped', false) ? '' : '<p class="swipe-hint" id="swipe-hint">👈 左右にスワイプでカテゴリを移動できます 👉</p>';
    $('#list').innerHTML = hint + groups.map((c) => {
      const list = items.filter((i) => i.category === c.id);
      const done = list.filter((i) => readIds.has(i.id)).length;
      return `<div class="cat-head" data-cat="${c.id}"><span class="dot">${c.emoji}</span>${esc(c.name)}<span class="count">${done}/${list.length}</span></div>` +
        list.map(cardHTML).join('');
    }).join('');
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
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#backdrop').hidden = true;
    document.body.style.overflow = '';
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
    if (t.dataset.save) return toggleSave(t.dataset.save);
    if (t.dataset.view) return show(t.dataset.view);
    if (t.dataset.filter) {
      const order = filterOrder();
      const dir = Math.sign(order.indexOf(t.dataset.filter) - order.indexOf(filter));
      setFilter(t.dataset.filter, dir);
      return;
    }
    if (t.classList.contains('slot') && t.dataset.id) return openEdition(t.dataset.id);
    if (t.closest('#past-list') && t.dataset.id) { await openEdition(t.dataset.id); return show('home'); }
    if ((t.classList.contains('card') || t.classList.contains('hero-card')) && t.dataset.id) return openSheet(t.dataset.id);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ---------- 左右スワイプでカテゴリを移動 ----------
  function filterOrder() {
    const items = edition?.items || [];
    return ['all', ...cats.filter((c) => c.id !== 'saitama' && items.some((i) => i.category === c.id)).map((c) => c.id)];
  }
  function setFilter(next, dir = 0) {
    if (next === filter) return;
    filter = next;
    renderHome();
    const list = $('#list');
    list.classList.remove('slide-l', 'slide-r');
    void list.offsetWidth;
    if (dir) list.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    // 選んだカテゴリのボタンが見えるように横に寄せる
    const chips = $('#chips');
    const chip = chips.querySelector(`[data-filter="${next}"]`);
    if (chip) chips.scrollTo({ left: chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
    // カテゴリの先頭が見える位置へ
    if (window.scrollY > chips.offsetTop) window.scrollTo({ top: chips.offsetTop - 4 });
  }
  function nudge(dir) {
    const list = $('#list');
    list.classList.remove('nudge-l', 'nudge-r');
    void list.offsetWidth;
    list.classList.add(dir > 0 ? 'nudge-l' : 'nudge-r');
  }
  // 指の動きに合わせて一覧を横に動かし、離したときに十分動いていればカテゴリを切り替える
  let sw = null;
  const home = $('#view-home');
  const listEl = $('#list');
  function resetDrag(animate) {
    listEl.style.transition = animate ? 'transform .2s ease, opacity .2s ease' : '';
    listEl.style.transform = '';
    listEl.style.opacity = '';
    if (animate) setTimeout(() => { listEl.style.transition = ''; }, 220);
  }
  home.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    // 横に動く「いちばんの話題」とカテゴリボタン、画面の左端（戻る操作）は対象外
    if (e.touches.length > 1 || e.target.closest('.hero, .chips') || t.clientX < 16) { sw = null; return; }
    sw = { x: t.clientX, y: t.clientY, lock: null, dx: 0 };
  }, { passive: true });
  home.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const t = e.touches[0];
    const dx = t.clientX - sw.x;
    const dy = t.clientY - sw.y;
    if (!sw.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; // 最初に動いた向きで、横スワイプか縦スクロールかを決める
    }
    if (sw.lock !== 'x') return;
    e.preventDefault(); // 横に動かしている間は縦にスクロールさせない
    sw.dx = dx;
    const order = filterOrder();
    const atEdge = (dx > 0 && order.indexOf(filter) === 0) || (dx < 0 && order.indexOf(filter) === order.length - 1);
    const move = atEdge ? dx * 0.15 : dx * 0.6;
    listEl.style.transition = 'none';
    listEl.style.transform = `translateX(${move}px)`;
    listEl.style.opacity = String(1 - Math.min(Math.abs(move) / 500, 0.35));
  }, { passive: false });
  const endSwipe = () => {
    if (!sw) return;
    const { lock, dx } = sw;
    sw = null;
    if (lock !== 'x') return;
    const order = filterOrder();
    const dir = dx < 0 ? 1 : -1; // 左へスワイプ＝次のカテゴリ
    const i = order.indexOf(filter) + dir;
    if (Math.abs(dx) < 50 || i < 0 || i >= order.length) {
      resetDrag(true);
      if (Math.abs(dx) >= 50) nudge(dir);
      return;
    }
    resetDrag(false);
    setFilter(order[i], dir);
    store.set('swiped', true);
    $('#swipe-hint')?.remove();
  };
  home.addEventListener('touchend', endSwipe, { passive: true });
  home.addEventListener('touchcancel', () => { sw = null; resetDrag(true); }, { passive: true });

  // シートを下にスワイプで閉じる
  let startY = null;
  $('#sheet').addEventListener('touchstart', (e) => { startY = $('#sheet').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  $('#sheet').addEventListener('touchend', (e) => {
    if (startY !== null && e.changedTouches[0].clientY - startY > 90) closeSheet();
    startY = null;
  });

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

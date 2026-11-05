// ニュースを集めて「朝・昼・夜」の1号ぶんを作るスクリプト
// 使い方: node scripts/build-edition.mjs
// 環境変数 ANTHROPIC_API_KEY があれば、AI が「ざっくり要約・話のネタ・用語解説」を付ける
import fs from 'node:fs/promises';
import path from 'node:path';
import { CATEGORIES, BUZZ_FEEDS, NG_WORDS, NG_WORDS_LOCAL, LOCAL_BOOST } from './feeds.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const EDITIONS = path.join(DATA, 'editions');
const KEEP_DAYS = 30;
const MODEL = process.env.NEWS_AI_MODEL || 'claude-sonnet-5-5';

// ---------- 日付（日本時間） ----------
function jstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
  };
}
function slotOf(hour) {
  if (process.env.NEWS_SLOT) return process.env.NEWS_SLOT;
  if (hour < 10) return 'am';
  if (hour < 16) return 'noon';
  return 'pm';
}
const SLOT_LABEL = { am: '朝', noon: '昼', pm: '夜' };

// ---------- RSS 読み込み ----------
function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');
}
function stripTags(s = '') {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
}
function parseRss(xml, feedUrl) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    let title = stripTags(tag(b, 'title'));
    let source = stripTags(tag(b, 'source'));
    const link = tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const pub = tag(b, 'pubDate') || tag(b, 'dc:date');
    let desc = stripTags(tag(b, 'description'));
    const img = (b.match(/<(?:media:content|media:thumbnail|enclosure)[^>]*url="([^"]+)"/) || [])[1] || '';

    if (feedUrl.includes('news.google.com')) {
      // Google ニュースはタイトル末尾に「 - 媒体名」が付く。説明文はリンク集なので使わない
      const idx = title.lastIndexOf(' - ');
      if (idx > 0) {
        source = source || title.slice(idx + 3);
        title = title.slice(0, idx);
      }
      desc = '';
    }
    if (!source) {
      if (feedUrl.includes('nhk.or.jp')) source = 'NHK';
      else if (feedUrl.includes('yahoo.co.jp')) source = 'Yahoo!ニュース';
    }
    if (desc && desc.length > 200) desc = desc.slice(0, 200) + '…';
    if (!title || !link) continue;
    const t = Date.parse(pub);
    items.push({ title, link, source, desc, img, time: Number.isFinite(t) ? t : null });
  }
  return items;
}
async function fetchFeed(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; family-news-reader/1.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text(), url);
    console.log(`  ✓ ${items.length.toString().padStart(3)}件  ${url.slice(0, 90)}`);
    return items;
  } catch (e) {
    console.log(`  ✗ 取得失敗 (${e.message})  ${url.slice(0, 90)}`);
    return [];
  }
}

// ---------- 似た記事をまとめる ----------
function normalize(t) {
  return t
    .replace(/[【［\[(（].*?[】］\])）]/g, '')
    .replace(/[\s　・、。「」『』！？!?:：,，.．…\-－―〜~]/g, '')
    .toLowerCase();
}
function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

// ---------- AI で解説を付ける（任意） ----------
async function enrich(items) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log('ANTHROPIC_API_KEY が無いので AI 解説はスキップします');
    return null;
  }
  const list = items
    .map((it, i) => `[${i}] (${it.categoryName}) ${it.title}${it.desc ? `\n    概要: ${it.desc}` : ''}`)
    .join('\n');
  const prompt = `あなたは、ニュースをやさしく解説する編集者です。
読者は30代後半の女性で、パートをしながら家庭を切り盛りしています。
世の中の動きへの理解を深め、ママ友・パート仲間・家族との会話で自然に話題にできるようになりたいと思っています。

以下は今回の見出し一覧です。各記事について JSON で返してください。

ルール:
- 見出しと概要に書かれた事実だけを根拠にし、書かれていない数字・人名・経緯を作らない
- 背景知識は一般的に知られていることに限る。不確かなら書かない
- 専門用語を使わず、中学生にも分かる言葉で。です・ます調
- summary: 何が起きたかを2文以内（60〜90字）
- why: 「これって私たちにどう関係する？」の視点で1文（40〜70字）
- talk: 会話でそのまま使える一言。「〜らしいね」「〜って知ってた？」のような口語で1文（30〜60字）
- term: 見出し中の難しめの言葉を1つと、その意味（30〜60字）。なければ null
- emoji: 内容に合う絵文字1つ

また、今回のニュース全体をふまえた「ひとこと」(intro) を、親しみやすく40〜80字で書いてください。

返答は次の形の JSON のみ（前後に文章を付けない）:
{"intro":"...","items":[{"i":0,"summary":"...","why":"...","talk":"...","term":{"word":"...","meaning":"..."},"emoji":"..."}]}

見出し一覧:
${list}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    console.log(`AI 解説を ${json.items?.length ?? 0} 件付けました`);
    return json;
  } catch (e) {
    console.log(`AI 解説に失敗しました（見出しだけで続行）: ${e.message}`);
    return null;
  }
}

// ---------- メイン ----------
async function main() {
  const { date, hour } = jstNow();
  const slot = slotOf(hour);
  const id = `${date}-${slot}`;
  console.log(`=== ${date} ${SLOT_LABEL[slot]}の号を作ります ===`);

  await fs.mkdir(EDITIONS, { recursive: true });
  const indexPath = path.join(DATA, 'index.json');
  let index = [];
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {}

  // 直近の号に載せた記事は避ける（同じ日の朝・昼・夜で同じ話ばかりにならないように）
  const recentLinks = new Set();
  const recentTitles = [];
  for (const e of index.filter((e) => e.id !== id).slice(0, 3)) {
    try {
      const ed = JSON.parse(await fs.readFile(path.join(EDITIONS, `${e.id}.json`), 'utf8'));
      for (const it of ed.items) {
        recentLinks.add(it.link);
        recentTitles.push(bigrams(normalize(it.title)));
      }
    } catch {}
  }

  // 取得
  const pool = [];
  for (const cat of CATEGORIES) {
    console.log(`[${cat.name}]`);
    const results = await Promise.all(cat.feeds.map(fetchFeed));
    results.flat().forEach((it) => pool.push({ ...it, cat }));
  }
  console.log('[話題度チェック用]');
  const buzz = (await Promise.all(BUZZ_FEEDS.map(fetchFeed))).flat();

  const now = Date.now();
  const maxAge = (cat) => (cat.local ? 4 : 1.5) * 24 * 3600 * 1000;
  const all = [...pool, ...buzz.map((b) => ({ ...b, cat: null }))].map((it) => ({
    ...it,
    bg: bigrams(normalize(it.title)),
  }));

  // フィルタ
  const candidates = all.filter((it) => {
    if (!it.cat) return false;
    if (it.time && now - it.time > maxAge(it.cat)) return false;
    const ng = it.cat.local ? NG_WORDS_LOCAL : NG_WORDS;
    if (ng.some((w) => it.title.includes(w))) return false;
    if (recentLinks.has(it.link)) return false;
    if (recentTitles.some((r) => similarity(r, it.bg) > 0.6)) return false;
    return true;
  });

  // 話題度: 似た見出しが多くの媒体・フィードに出ているほど高い
  for (const it of candidates) {
    const sources = new Set();
    for (const o of all) if (o !== it && similarity(o.bg, it.bg) > 0.5) sources.add(o.source || o.link);
    const ageH = it.time ? (now - it.time) / 3600000 : 12;
    it.buzz = sources.size;
    it.score = sources.size * 3 + Math.max(0, 24 - ageH) / 6 + (it.desc ? 0.5 : 0);
    if (it.cat.local) {
      const boost = LOCAL_BOOST.filter((w) => it.title.includes(w)).length;
      it.score += boost * 4;
      if (!/埼玉|川越|所沢|狭山|入間|ふじみ野|坂戸|東松山|さいたま|秩父|熊谷|川口|越谷|草加|春日部|上尾|朝霞|新座|志木|和光|富士見|飯能|日高|鶴ヶ島|毛呂山|三芳/.test(it.title + it.desc)) {
        it.score -= 6; // 埼玉と関係なさそうな記事は下げる
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // カテゴリごとに選ぶ（全体で重複しないように）
  const chosen = [];
  const perCat = new Map();
  for (const it of candidates) {
    const n = perCat.get(it.cat.id) || 0;
    if (n >= it.cat.pick) continue;
    if (it.cat.local && it.score < 0) continue;
    if (chosen.some((c) => c.link === it.link || similarity(c.bg, it.bg) > 0.5)) continue;
    chosen.push(it);
    perCat.set(it.cat.id, n + 1);
  }
  if (chosen.length < 5) {
    console.log(`記事が ${chosen.length} 件しか集まらなかったので、今回は更新しません`);
    process.exitCode = 0;
    return;
  }

  // 並び順はカテゴリ順 → スコア順
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  chosen.sort((a, b) => order.get(a.cat.id) - order.get(b.cat.id) || b.score - a.score);

  // いちばん話題の3本（埼玉以外から）
  const top = [...chosen]
    .filter((c) => !c.cat.local)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.link);

  const items = chosen.map((it, i) => ({
    id: `${id}-${i}`,
    category: it.cat.id,
    categoryName: it.cat.name,
    title: it.title,
    link: it.link,
    source: it.source || '',
    desc: it.desc || '',
    img: it.img || '',
    time: it.time ? new Date(it.time).toISOString() : null,
    buzz: it.buzz,
    top: top.includes(it.link),
  }));

  const ai = await enrich(items);
  if (ai?.items) {
    for (const a of ai.items) {
      const it = items[a.i];
      if (!it) continue;
      Object.assign(it, {
        summary: a.summary || '',
        why: a.why || '',
        talk: a.talk || '',
        term: a.term && a.term.word ? a.term : null,
        emoji: a.emoji || '',
      });
    }
  }

  const edition = {
    id,
    date,
    slot,
    label: SLOT_LABEL[slot],
    generatedAt: new Date().toISOString(),
    intro: ai?.intro || '',
    ai: Boolean(ai),
    categories: CATEGORIES.map(({ id, name, emoji }) => ({ id, name, emoji })),
    items,
  };
  await fs.writeFile(path.join(EDITIONS, `${id}.json`), JSON.stringify(edition, null, 1));

  // 目次を更新（古い号は削除）
  index = index.filter((e) => e.id !== id);
  index.unshift({ id, date, slot, label: edition.label, generatedAt: edition.generatedAt, count: items.length });
  index.sort((a, b) => (a.id < b.id ? 1 : -1));
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const keep = index.filter((e) => e.date >= limit);
  for (const e of index.filter((e) => e.date < limit)) {
    await fs.rm(path.join(EDITIONS, `${e.id}.json`), { force: true });
  }
  await fs.writeFile(indexPath, JSON.stringify(keep, null, 1));
  console.log(`=== 完了: ${items.length} 件（${[...perCat].map(([k, v]) => `${k}:${v}`).join(' ')}） ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ニュースを集めて「朝・昼・夜」の1号ぶんを作るスクリプト
// 使い方: node scripts/build-edition.mjs
// 環境変数 GEMINI_API_KEY（無料）か ANTHROPIC_API_KEY があれば、AI が要約・ポイント・話のネタを付ける
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORIES, BUZZ_FEEDS, NG_WORDS, NG_WORDS_LOCAL, NG_SOURCES, LOCAL_BOOST } from './feeds.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const EDITIONS = path.join(DATA, 'editions');
const KEEP_DAYS = 30;
const MODEL = process.env.NEWS_AI_MODEL || 'claude-opus-5-5';

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
// ---------- 記事ページから概要を取ってくる ----------
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Google ニュースの転送用 URL を、元の記事の URL に変換する
async function resolveGoogleUrl(url) {
  const id = (url.match(/\/articles\/([^?/]+)/) || [])[1];
  if (!id) return url;
  try {
    const page = await (await fetch(`https://news.google.com/articles/${id}?hl=ja&gl=JP&ceid=JP:ja`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
    })).text();
    const sg = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return null;
    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"JP:ja",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
    const text = await (await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body, signal: AbortSignal.timeout(10000),
    })).text();
    const m = text.match(/garturlres\\",\\"(https?:[^"\\]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function metaContent(html, key) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? stripTags(decode(m[1])) : '';
}

// 記事の本文らしい段落を取り出す（AI に要約してもらうためだけに使い、公開データには入れない）
function extractBody(html) {
  let h = html.replace(/<(script|style|noscript|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const article = h.match(/<article[\s\S]*?<\/article>/i);
  if (article) h = article[0];
  const paras = [];
  for (const m of h.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)) {
    const t = stripTags(decode(m[1]));
    if (t.length < 25) continue;
    if (/Copyright|無断転載|©|ログイン|会員登録|クッキー|Cookie|JavaScript/.test(t)) continue;
    paras.push(t);
  }
  return [...new Set(paras)].join('\n').slice(0, 2500);
}

async function fetchDescription(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { url: res.url || url, desc: '' };
    const buf = Buffer.from(await res.arrayBuffer());
    // 文字コード（Shift_JIS などのサイトもある）
    let charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
    if (!charset) charset = buf.toString('latin1', 0, 3000).match(/charset=["']?([\w-]+)/i)?.[1];
    let html;
    try { html = new TextDecoder(charset || 'utf-8').decode(buf); } catch { html = buf.toString('utf8'); }
    const desc = metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description');
    return { url: res.url || url, desc, body: extractBody(html) };
  } catch {
    return { url, desc: '', body: '' };
  }
}

// 並列数を絞って順番に処理する
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

async function fillDescriptions(items) {
  const targets = items.filter((it) => !it.desc);
  let resolved = 0;
  let got = 0;
  let bodies = 0;
  await mapLimit(items, 6, async (it) => {
    let url = it.link;
    if (url.includes('news.google.com')) {
      const real = await resolveGoogleUrl(url);
      if (!real) return;
      resolved++;
      url = real;
      it.link = real; // 元の記事に直接飛べるようにする
    }
    const { desc, body } = await fetchDescription(url);
    if (body && body.length > 80) {
      it.body = body;
      bodies++;
    }
    if (desc && !it.desc) it.rawDesc = desc;
  });
  // サイト共通の決まり文句（どの記事でも同じ説明文）は使わない
  const counts = new Map();
  for (const it of targets) if (it.rawDesc) counts.set(it.rawDesc, (counts.get(it.rawDesc) || 0) + 1);
  for (const it of targets) {
    const d = it.rawDesc;
    delete it.rawDesc;
    if (!d || counts.get(d) > 1 || d.length < 25) continue;
    if (similarity(bigrams(normalize(d)), bigrams(normalize(it.title))) > 0.85 && d.length < it.title.length + 15) continue;
    if (/公式サイト|ニュースサイト|最新ニュース|をお届け|ホームページ|県紙|地方紙/.test(d)) continue;
    // 見出しとほとんど言葉がかぶらない説明文は、サイト共通の紹介文の可能性が高い
    if (similarity(bigrams(normalize(d)), bigrams(normalize(it.title))) < 0.15) continue;
    it.desc = d.length > 300 ? d.slice(0, 300) + '…' : d;
    got++;
  }
  console.log(`概要の追加: Google転送の解決 ${resolved}件 / 概要を取得 ${got}件（対象 ${targets.length}件） / 本文を取得 ${bodies}件`);
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

// ---------- AI で要約・解説を付ける（ANTHROPIC_API_KEY があるときだけ） ----------
const ItemNote = z.object({
  i: z.number().int(),
  summary: z.string(),
  points: z.array(z.string()),
  why: z.string(),
  talk: z.string(),
  term: z.object({ word: z.string(), meaning: z.string() }).nullable(),
  emoji: z.string(),
});
const BatchNotes = z.object({ items: z.array(ItemNote) });
const Intro = z.object({ intro: z.string() });

const GUIDE = `あなたは、ニュースをやさしく解説する編集者です。
読者は30代後半の女性で、パートをしながら家庭を切り盛りしています。
記事のリンクを開かなくても、このアプリの文章だけで内容がわかり、ママ友・パート仲間・家族との会話で自然に話題にできることが目標です。

ルール:
- 記事本文・概要・見出しに書かれている事実だけを使う。書かれていない数字・人名・経緯は作らない
- 背景の説明は、一般によく知られていることに限る。不確かなことは書かない
- 本文がなく見出ししか無い記事は、見出しから確実に言えることだけを短く書く
- 専門用語を避け、中学生にもわかる言葉で、です・ます調
- 記事の文章を長く書き写さず、自分の言葉でまとめる`;

const FIELDS = `各記事について:
- summary: 記事を開かなくても読み切れる要約。「いつ・どこで・誰が・何をした・どうなる」がわかるように3〜5文（150〜250字）
- points: 押さえておきたい点を2〜3個（各20〜40字）
- why: 「これって私たちの暮らしにどう関係する？」を1文（40〜70字）
- talk: 会話でそのまま使える一言。「〜らしいね」「〜って知ってた？」のような口語で1文（30〜60字）
- term: 記事中の難しめの言葉を1つとその意味（30〜60字）。なければ null
- emoji: 内容に合う絵文字1つ
- i: 記事の番号（そのまま返す）`;

function articleText(it, i, bodyLimit) {
  const parts = [`[${i}] ${it.title}（${it.source || '出典不明'}）`];
  if (it.desc) parts.push(`概要: ${it.desc}`);
  if (it.body) parts.push(`本文:\n${it.body.slice(0, bodyLimit)}`);
  return parts.join('\n');
}

// 安全チェックで断られたときに、別のモデルで自動でやり直す設定（対応モデルだけ）
function fallbackParams() {
  if (/^claude-(opus-5-5|sonnet-5-5|opus-5|fable-5-1)$/.test(MODEL)) {
    return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  }
  return {};
}

async function askClaude(client, prompt, schema) {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    ...fallbackParams(),
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') throw new Error('AI が回答を控えました');
  if (res.stop_reason === 'max_tokens') throw new Error('回答が長すぎて途中で切れました');
  if (!res.parsed_output) throw new Error('回答を読み取れませんでした');
  return res.parsed_output;
}

// ---- 無料: Google Gemini（Google AI Studio の無料枠。GEMINI_API_KEY が必要、カード登録は不要） ----
const LooseNote = z.object({
  i: z.coerce.number().int(),
  summary: z.string().min(1),
  points: z.array(z.string()).default([]),
  why: z.string().default(''),
  talk: z.string().default(''),
  term: z.object({ word: z.string(), meaning: z.string() }).nullable().optional(),
  emoji: z.string().default(''),
});
const LooseBatch = z.object({ items: z.array(LooseNote) });
const JSON_SHAPE_BATCH = `返答は次の形の JSON オブジェクトだけにしてください（前後に文章を付けない）:
{"items":[{"i":0,"summary":"...","points":["...","..."],"why":"...","talk":"...","term":{"word":"...","meaning":"..."},"emoji":"..."}]}
term が無いときは null にしてください。`;
const JSON_SHAPE_INTRO = '返答は {"intro":"..."} の形の JSON オブジェクトだけにしてください。';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
// 指定が無ければ、使える flash 系のいちばん新しいモデルを自動で選ぶ
let geminiModel = process.env.NEWS_GEMINI_MODEL || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 指定のモデルが使えるか確認し、無ければ使える「flash」系のいちばん新しいものを選ぶ
async function chooseGeminiModel() {
  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.log(`  Gemini のモデル一覧を取得できませんでした (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
      return;
    }
    const models = ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    // 混雑時に切り替える候補：flash 系と flash-lite 系を新しい順に
    const ver = (n) => parseFloat(n.slice(7)) || 0;
    const flash = models
      .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n))
      .sort((a, b) => ver(b) - ver(a) || a.length - b.length);
    geminiCandidates = [...new Set([...(geminiModel && models.includes(geminiModel) ? [geminiModel] : []), ...flash])];
    if (!geminiCandidates.length) {
      const any = models.find((n) => n.includes('flash') && !/image|tts|live|audio/.test(n));
      if (any) geminiCandidates = [any];
    }
    if (geminiCandidates.length) {
      if (geminiModel && geminiModel !== geminiCandidates[0]) console.log(`  ${geminiModel} は使えないので ${geminiCandidates[0]} を使います`);
      geminiModel = geminiCandidates[0];
      console.log(`  混雑時の切り替え候補: ${geminiCandidates.join(', ')}`);
    }
  } catch (e) {
    console.log(`  Gemini のモデル確認に失敗: ${e.message}`);
  }
}

let geminiCandidates = [];
// 混雑・時間切れのときは次の候補モデルへ（全員で共有）
function nextGeminiModel(from, reason) {
  if (geminiModel !== from) return true; // 別の依頼がもう切り替えた
  const i = geminiCandidates.indexOf(from);
  const next = geminiCandidates[i + 1];
  if (!next) return false;
  console.log(`  ${from} が${reason}なので ${next} に切り替えます`);
  geminiModel = next;
  return true;
}
let geminiThinkingLow = true; // 「考える量を少なめに」して速くする（対応していないモデルなら自動で外す）
async function askGemini(prompt, schema) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const model = geminiModel;
    let res;
    try {
      res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'あなたは日本語のニュース編集者です。指示された形の JSON オブジェクトだけを返します。' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
          maxOutputTokens: 16384,
          ...(geminiThinkingLow ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: AbortSignal.timeout(90000),
      });
    } catch (e) {
      // 時間切れ：次のモデルで試す
      if (nextGeminiModel(model, '時間切れ')) continue;
      throw e;
    }
    const raw = await res.text();
    if (res.status === 400 && geminiThinkingLow && /thinking/i.test(raw)) {
      geminiThinkingLow = false;
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      // 1日の上限に達したときは待っても無駄なのですぐやめる
      const daily = /PerDay|per day|daily/i.test(raw);
      if (nextGeminiModel(model, daily ? '今日の無料枠を使い切ったの' : '混雑中')) continue;
      if (daily) throw new Error(`今日の無料枠を使い切りました: ${raw.slice(0, 160)}`);
      const wait = Number(process.env.NEWS_RETRY_WAIT_SEC) || 15 * (attempt + 1);
      console.log(`  （混雑のため ${wait} 秒待ちます: HTTP ${res.status} ${raw.replace(/\s+/g, ' ').slice(0, 120)}）`);
      await sleep(wait * 1000);
      continue;
    }
    // 「このモデルは提供終了、代わりに〜を使って」と言われたら、そのモデルに切り替えてやり直す
    const suggested = res.status === 404 && raw.match(/use models\/([\w.-]+)/);
    if (suggested && suggested[1] !== model) {
      console.log(`  ${model} は提供終了とのことなので ${suggested[1]} に切り替えます`);
      geminiCandidates = [suggested[1], ...geminiCandidates.filter((m) => m !== model && m !== suggested[1])];
      geminiModel = suggested[1];
      continue;
    }
    if (res.status === 404 && nextGeminiModel(model, '使えないの')) continue;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 200)}`);
    let text = '';
    try {
      const data = JSON.parse(raw);
      text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error(`返事が空でした（${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '理由不明'}）`);
    } catch (e) {
      throw new Error(e.message.startsWith('返事') ? e.message : `想定外の返事: ${raw.slice(0, 120)}`);
    }
    let json;
    try {
      json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      throw new Error('回答を読み取れませんでした');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error('回答の形が想定と違いました');
    return parsed.data;
  }
  throw new Error('混雑が続いたのであきらめました');
}

// 使える AI を選ぶ（Claude のキーがあればそれ、無ければ Gemini の無料枠）
function pickProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic();
    return {
      label: `Claude（${MODEL}）`,
      batchSize: 8, bodyLimit: 2500, concurrency: 3, shapeBatch: '', shapeIntro: '',
      batchSchema: BatchNotes, introSchema: Intro,
      ask: (prompt, schema) => askClaude(client, prompt, schema),
    };
  }
  if (process.env.GEMINI_API_KEY) {
    // 無料枠は1分あたりの回数が少ないので、1件ずつ順番に、間をあけて頼む
    return {
      get label() { return `Gemini 無料枠（${geminiModel}）`; },
      batchSize: 4, bodyLimit: 1800, concurrency: 2, shapeBatch: JSON_SHAPE_BATCH, shapeIntro: JSON_SHAPE_INTRO,
      batchSchema: LooseBatch, introSchema: Intro,
      check: chooseGeminiModel,
      ask: async (prompt, schema) => {
        const out = await askGemini(prompt, schema);
        await sleep(Number(process.env.NEWS_AI_GAP_MS ?? 4000));
        return out;
      },
    };
  }
  return null;
}

async function enrich(items) {
  const ai = pickProvider();
  if (!ai) {
    console.log('使える AI が無いので AI 要約はスキップします（記事の書き出しを表示します）');
    return null;
  }
  if (ai.check) await ai.check();
  console.log(`AI 要約を作ります（${ai.label}）`);

  // カテゴリごとに、決まった本数ずつまとめて頼む
  const groups = new Map();
  items.forEach((it, i) => {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(i);
  });
  const batches = [];
  for (const idxs of groups.values()) {
    for (let k = 0; k < idxs.length; k += ai.batchSize) batches.push(idxs.slice(k, k + ai.batchSize));
  }

  let done = 0;
  let tried = 0;
  const deadline = Date.now() + Number(process.env.NEWS_AI_BUDGET_SEC || 360) * 1000;
  await mapLimit(batches, ai.concurrency, async (idxs) => {
    if (Date.now() > deadline) return; // 時間切れ：残りは記事の書き出しで表示
    const t0 = Date.now();
    tried++;
    const list = idxs.map((i) => articleText(items[i], i, ai.bodyLimit)).join('\n\n---\n\n');
    const prompt = `${GUIDE}\n\n${FIELDS}\n\n${ai.shapeBatch}\n\n記事一覧:\n\n${list}`;
    try {
      const out = await ai.ask(prompt, ai.batchSchema);
      for (const a of out.items) {
        const it = items[a.i];
        if (!it || !idxs.includes(a.i)) continue;
        Object.assign(it, {
          summary: a.summary,
          points: (a.points || []).slice(0, 3),
          why: a.why,
          talk: a.talk,
          term: a.term && a.term.word ? a.term : null,
          emoji: a.emoji,
        });
        done++;
      }
      console.log(`  ${items[idxs[0]].categoryName}: ${out.items.length}件 OK（${Math.round((Date.now() - t0) / 1000)}秒）`);
    } catch (e) {
      console.log(`  AI 要約に失敗（${items[idxs[0]].categoryName}）: ${e.message}`);
    }
  });
  console.log(`AI 要約を ${done}/${items.length} 件に付けました（${tried}/${batches.length} 回依頼${tried < batches.length ? '、時間切れで残りは省略' : ''}）`);
  if (!done) return null;

  let intro = '';
  try {
    const list = items.filter((it) => it.summary).map((it) => `・(${it.categoryName}) ${it.title}`).join('\n');
    const out = await ai.ask(
      `${GUIDE}\n\n今回のニュース一覧をふまえて、アプリの冒頭に出す「ひとこと」(intro) を、親しみやすく40〜80字で書いてください。\n${ai.shapeIntro}\n\n${list}`,
      ai.introSchema,
    );
    intro = out.intro;
  } catch (e) {
    console.log(`  ひとことの作成に失敗: ${e.message}`);
  }
  return { intro };
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
    if (/[\[［]\d{3}[\dA-Z][\]］]|[（(]\d{3}[A-Z][)）]/.test(it.title)) return false; // 証券コード付きの開示情報
    if (NG_SOURCES.some((w) => (it.source || '').includes(w))) return false;
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

  await fillDescriptions(items);
  const ai = await enrich(items);
  for (const it of items) delete it.body; // 記事本文は公開データに入れない

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

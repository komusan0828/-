// ニュースの取得元とカテゴリの設定
// Google ニュースの検索 RSS は「when:1d」で直近1日に絞り込める
const g = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
const gTopic = (t) =>
  `https://news.google.com/rss/headlines/section/topic/${t}?hl=ja&gl=JP&ceid=JP:ja`;
const nhk = (n) => `https://www.nhk.or.jp/rss/news/cat${n}.xml`;
const yahoo = (n) => `https://news.yahoo.co.jp/rss/topics/${n}.xml`;

// 並び順がそのまま画面のカテゴリ順・重複時の優先順になる
export const CATEGORIES = [
  {
    id: 'saitama',
    name: '埼玉',
    emoji: '📍',
    pick: 8,
    local: true,
    feeds: [
      g('川越 when:3d'),
      g('所沢 when:3d'),
      g('(ふじみ野 OR 狭山 OR 入間 OR 坂戸 OR 東松山) when:3d'),
      g('埼玉県 when:1d'),
    ],
  },
  {
    id: 'politics',
    name: '政治',
    emoji: '🏛️',
    pick: 5,
    feeds: [nhk(4), g('(国会 OR 首相 OR 政府 OR 与党 OR 野党 OR 選挙) when:1d')],
  },
  {
    id: 'economy',
    name: '経済',
    emoji: '💴',
    pick: 5,
    feeds: [nhk(5), yahoo('business'), g('(物価 OR 円相場 OR 日銀 OR 株価 OR 賃上げ) when:1d')],
  },
  {
    id: 'world',
    name: '国際',
    emoji: '🌏',
    pick: 5,
    feeds: [nhk(6), yahoo('world'), gTopic('WORLD')],
  },
  {
    id: 'society',
    name: '社会',
    emoji: '🏙️',
    pick: 5,
    feeds: [nhk(1), yahoo('domestic'), gTopic('NATION')],
  },
  {
    id: 'life',
    name: 'くらし',
    emoji: '🛒',
    pick: 5,
    feeds: [
      g('(値上げ OR 値下げ OR 給付 OR 制度改正 OR 子育て支援 OR 年金 OR 電気代) when:2d'),
      gTopic('HEALTH'),
    ],
  },
  {
    id: 'business',
    name: 'ビジネス',
    emoji: '💼',
    pick: 5,
    feeds: [gTopic('BUSINESS'), g('(新商品 OR 新サービス OR 決算 OR 業績 OR 新店舗) when:1d')],
  },
  {
    id: 'science',
    name: '科学・IT',
    emoji: '🔬',
    pick: 5,
    feeds: [nhk(3), yahoo('science'), yahoo('it'), gTopic('SCIENCE'), gTopic('TECHNOLOGY')],
  },
];

// 「みんなが話題にしている」度合いを上げるための総合フィード（カテゴリには入れない）
export const BUZZ_FEEDS = [yahoo('top-picks'), nhk(0), gTopic('NATION')];

// 芸能・ゴシップ系は除外（埼玉カテゴリでは軽めのものは許可）
export const NG_WORDS = [
  '芸能', '熱愛', '不倫', '交際', '破局', '離婚', '結婚発表', '入籍', 'スキャンダル',
  'アイドル', 'ジャニーズ', 'STARTO', '女優', '俳優', 'タレント', '声優', '紅白',
  'ドラマ', '主演', '写真集', 'グラビア', 'YouTuber', 'ユーチューバー', '炎上',
  'インスタ', 'SNSで話題', '激似', '美脚', '水着', 'キャバ', 'ホスト',
];
export const NG_WORDS_LOCAL = ['熱愛', '不倫', '破局', '離婚', 'スキャンダル', 'グラビア', '水着'];

// 埼玉のなかでも特に優先したい地名
export const LOCAL_BOOST = ['川越', '所沢', '小江戸', '狭山', 'ふじみ野', '入間'];

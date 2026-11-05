# まいにちニュース 🗞️

会話のタネになるニュースを、**朝・昼・夜の1日3回**まとめて届けるスマホ向けニュースアプリです。

- 政治・経済・国際・社会・くらし・ビジネス・科学/IT を各5本、埼玉（川越・所沢中心）を8本
- 芸能・ゴシップは自動で除外（埼玉ニュースは軽い話題も OK）
- 「いちばんの話題」TOP3、読んだ数の進み具合、連続で読んだ日数🔥、記事の保存⭐
- AI（Claude）を有効にすると、各記事に「ざっくり言うと」「わたしたちとの関係」「会話で使うなら」「ことば解説」が付きます
- ホーム画面に追加するとアプリのように使えます

## しくみ

GitHub Actions が日本時間 6:30 / 11:30 / 18:30 ごろに NHK・Yahoo!ニュース・Google ニュースの RSS を集め、
`docs/data/` に保存して GitHub Pages で公開します。サーバー代はかかりません。

## はじめかた（最初の1回だけ）

1. **公開設定**：GitHub Pages を無料プランで使うにはリポジトリを Public にする必要があります
   （Settings → General → Danger Zone → Change visibility）。中身はニュースの見出しだけで個人情報は含みません。
   GitHub Pro なら Private のままで OK。
2. **Pages を有効に**：Settings → Pages → Source を「**GitHub Actions**」にする
3. **（おすすめ）AI 要約を有効に**：Settings → Secrets and variables → Actions → New repository secret で
   名前 `ANTHROPIC_API_KEY`、値に Anthropic の API キーを登録。
   記事本文を AI が読み、リンクを開かなくても読み切れる要約・ポイント・会話のネタを付けます。
   未設定のときは、記事の書き出し（サイトが公開している説明文）を表示します。

   使うモデルは Variables タブで `NEWS_AI_MODEL` を作ると変えられます（未設定なら `claude-opus-5-5`）。
   1日3回・約45本のときの目安（記事の長さで上下します）:

   | モデル | 月額の目安 |
   |---|---|
   | `claude-opus-5-5`（標準・いちばん丁寧） | 約 9,000 円 |
   | `claude-sonnet-5-5` | 約 4,500 円 |
   | `claude-haiku-5-5`（いちばん安い） | 約 250 円 |
4. **初回の実行**：Actions タブ →「ニュースを集めて公開」→ Run workflow
5. 公開 URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）をスマホで開き、
   共有ボタン →「ホーム画面に追加」

## カスタマイズ

- 取得元・カテゴリ・本数・除外ワード：`scripts/feeds.mjs`
- 更新時刻：`.github/workflows/news.yml` の `cron`（UTC 表記）
- AI の文体や解説の内容：`scripts/build-edition.mjs` のプロンプト
- 手元で試す：`node scripts/build-edition.mjs`（Node 20 以上）

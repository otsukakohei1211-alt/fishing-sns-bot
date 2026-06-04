# fishing-sns-bot

神奈川県・本牧海づり施設の釣果情報を取得 → 投稿文を生成するボット。

**取得 → 投稿文生成 → Xの下書き入力（投稿ボタンの手前で停止）** までを実装。最後の「ポスト」ボタンだけ人間が押す運用。

## セットアップ

```bash
npm install
npx playwright install chromium   # 調査スクリプト用（本実装は fetch のみ）
cp .env.example .env              # ANTHROPIC_API_KEY を記入
```

## コマンド

```bash
# 1) 釣果データを取得（直近2日分・最大7日遡る）
npm run scrape:honmoku

# 2) 投稿文を生成（最新スナップショットから）
npm run compose

# 1+2 をまとめて
npm run run:weekly

# 3) X の認証クッキーを取り込み（最初の一度だけ）
#    方法A: 対話的に auth_token と ct0 を貼り付け
npm run x:login
#    方法B: ブラウザ拡張(Cookie-Editor等)でエクスポートしたJSONを読み込み
npm run x:import -- ~/Downloads/x.com_cookies.json

# 4) X の投稿作成画面を開いて本文を入力（ボタンは押さず停止）
npm run x:draft
# 別の投稿文ファイルを指定したい場合
npm run x:draft -- data/snapshots/post_2026-05-22.txt
```

出力先:
- `data/snapshots/honmoku_YYYY-MM-DD.json` — 取得したレポート
- `data/snapshots/post_YYYY-MM-DD.txt` — 生成された投稿文
- `data/auth/x_state.json` — X のセッション（gitignore済み）

## データソース

- 本牧海づり施設 公式サイト (`yokohama-fishingpiers.jp/honmoku/fishing-history`)
  の AWS AppSync GraphQL API を直接利用
- `facility` パラメータを切り替えれば 大黒 / 磯子 も同じ構造で取得可能（拡張は容易）
- ANGLERS は利用規約で複製・転載を禁止しているため対象外

## 取得フィールド

1日1レコードに以下が含まれる:

- `date` / `weather` / `waterTemp` / `tide` / `visitors`
- `comment` — 施設コメント本文（仕掛け・釣り方・注意点を含む）
- `catches[]` — 魚種ごとに `name / count / minSize / maxSize / unit / places[]`

## 運用フロー（週次）

1. `npm run run:weekly` — 取得＋投稿文生成（cron で自動化可）
2. `npm run x:draft` — ブラウザが開いて投稿文が入力された状態になる
3. 人間が内容を確認して『ポストする』ボタンを押す

セッションが切れた場合は `npm run x:login` または `npm run x:import` を再実行してください。

## X 認証クッキーの取得手順

Playwright が起動した Chromium だと X 側のセキュリティ判定で弾かれることがあるため、
**普段使っているブラウザで X にログインした状態のクッキーをコピーして使う** 運用にしています。
クッキーは `data/auth/x_state.json` に保存され、`.gitignore` 済みです。

### 方法A: DevTools から直接コピー

1. 普段のブラウザ（Chrome/Safari/Firefox 等）で `https://x.com` を開きログイン状態にする
2. DevTools (Cmd+Option+I) → **Application タブ** → 左サイドバーの **Cookies** → `https://x.com`
3. 以下2つのクッキーの **Value** をコピー
   - `auth_token` (40文字程度の16進文字列、HttpOnly)
   - `ct0` (150文字程度、CSRFトークン)
4. ターミナルで `npm run x:login` を実行し、プロンプトに沿って順に貼り付け

### 方法B: 拡張機能でエクスポート

1. Chrome 拡張 [Cookie-Editor](https://cookie-editor.com/) または EditThisCookie をインストール
2. x.com を開いた状態で拡張機能を起動 → **Export** → **JSON** を選択
3. ダウンロードした JSON ファイルパスを指定して取り込み
   ```bash
   npm run x:import -- ~/Downloads/x.com_cookies.json
   ```

### セキュリティ注意

- `auth_token` はそのアカウントへの完全アクセス権を持ちます。**ローカル開発環境以外で扱わない**こと
- `data/auth/x_state.json` は `.gitignore` 済み。コミット禁止
- 不要になったらこのファイルを削除すれば即座にローカルからアクセス権を消せます
- 本番想定の用途では、X API v2 を使った正規の OAuth 認証を検討してください

## メール通知のセットアップ（Resend）

`npm run run:weekly` の最後で、生成された投稿文を Resend 経由で `NOTIFY_EMAIL` に送ります。

### 初回セットアップ

1. [resend.com](https://resend.com) にサインアップ（メールアドレスは通知先と同じものを使う）
2. API Keys → Create API Key → `re_...` をコピー
3. `.env` に以下を記入
   ```env
   RESEND_API_KEY=re_xxxxxxxxxxxxx
   NOTIFY_EMAIL=otsukakohei1211@gmail.com
   ```
4. 動作確認: `npm run run:weekly` を実行 → 受信を確認

### 制約

- Resend 無料プランは送信元ドメインを検証しないと、宛先は **Resend アカウント登録時のメールアドレス** に限定されます（`onboarding@resend.dev` から送信）
- 100通/日まで無料

## 自動実行（launchd）

毎週 **金曜 20:00 / 土曜 20:00 JST** に `npm run run:weekly` が走り、メール通知が届く構成。

### 登録手順

```bash
# 1) plist をユーザーの LaunchAgents にシンボリックリンク
ln -sf "$(pwd)/launchd/com.otsuka.fishing-sns-bot.plist" \
       ~/Library/LaunchAgents/com.otsuka.fishing-sns-bot.plist

# 2) ロード（macOS 10.10+）
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.otsuka.fishing-sns-bot.plist

# 3) 登録確認
launchctl list | grep otsuka.fishing
```

### 動作確認・運用

```bash
# 今すぐ手動で実行（次の金土を待たずにテスト）
launchctl kickstart gui/$UID/com.otsuka.fishing-sns-bot

# 実行ログを見る
ls data/logs/
tail -f data/logs/launchd.err.log

# 一時停止（再有効化は bootstrap で再ロード）
launchctl bootout gui/$UID/com.otsuka.fishing-sns-bot

# plist を変更したら再ロード
launchctl bootout  gui/$UID/com.otsuka.fishing-sns-bot
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.otsuka.fishing-sns-bot.plist
```

### 注意点

- **Mac がスリープしていた時刻はスキップ**されます。確実に起こしたい場合は次のコマンドで wake を設定:
  ```bash
  sudo pmset repeat wakeorpoweron FS 19:55:00
  # F=Friday, S=Saturday の意。19:55 に wake → 20:00 に起動
  ```
- Mac の TimeZone は JST 前提（`date` で確認可能）
- `.env` の API キーは launchd 経由でも `tsx` が `dotenv/config` で読み込みます

## 運用フロー（週次・自動化後）

1. 金/土の 20:00、Mac で自動実行 → 投稿文がメールで届く
2. メールを開いて文面を確認
3. ターミナルで `npm run x:draft` → 内容入力済みのブラウザが開く
4. 内容OKならブラウザの『ポストする』を押す

## まだ作っていないもの

- 大黒・磯子施設の対応（`Facility` 型は定義済み、`scrapers/honmoku.ts` を雛形に追加可能）
- メールから直接 X compose を開くワンクリックリンク（macOSのカスタムURLスキーム経由）

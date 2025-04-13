# Telegram RSSリーダーボット

Telegramチャンネル用のRSSリーダーボットです。チャンネルごとにRSSフィードを購読し、新しい記事が公開されると自動的に通知します。

## 特徴

- チャンネルごとのRSSフィード管理
- 管理者のみがコマンドを実行可能
- 頻繁な更新チェック（1分ごと）
- WebSub（PubSubHubbub）に対応したリアルタイム更新
- 簡単なコマンドでフィードを追加・削除

## インストール方法

### 必要条件

- Node.js 14.x以上
- npm または yarn
- SQLite3

### セットアップ

1. リポジトリをクローン：

```bash
git clone https://github.com/yourusername/tgrss.git
cd tgrss
```

2. 依存パッケージをインストール：

```bash
npm install
```

3. `.env`ファイルを作成し、必要な環境変数を設定：

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
PORT=3000
HOST_DOMAIN=http://example.com
EXTERNAL_PORT=80
```

- `TELEGRAM_BOT_TOKEN`: BotFatherから取得したTelegramボットトークン
- `PORT`: サーバーが実行されるポート（デフォルト: 3000）
- `HOST_DOMAIN`: 外部からアクセスするためのドメイン名
- `EXTERNAL_PORT`: 外部からアクセスする際のポート（80または443の場合は省略可能）

## 使い方

### ボットの起動

```bash
npm start
```

開発モードで起動（ファイル変更を監視）：

```bash
npm run dev
```

### ボットコマンド

ボットはチャンネル内でのメンションによってコマンドを受け付けます。すべてのコマンドはチャンネル管理者のみが実行できます。

#### RSSフィードの追加

```
@ボット名 add タイトル名 RSSのURL
```

例：
```
@rssreaderbot add テックブログ https://example.com/blog/feed
```

#### RSSフィードの削除

```
@ボット名 remove タイトル名
```

例：
```
@rssreaderbot remove テックブログ
```

#### 登録されているRSSフィード一覧の表示

```
@ボット名 list
```

### チャンネルへの追加方法

1. Telegramでボットを検索し、「Start」を押す
2. ボットをチャンネル管理者として追加
3. チャンネル内でRSSフィードを追加するコマンドを実行

## 技術仕様

- **Telegram Bot API**: ボットの操作とメッセージ送信
- **Express.js**: WebhookとAPIエンドポイントの提供
- **SQLite3**: RSSフィード情報の保存
- **Node-cron**: 定期的なRSSチェック
- **RSS-parser**: フィードの解析

## ホスティング

### リバースプロキシの設定

nginx設定例：

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### PM2で永続的に実行

```bash
npm install -g pm2
pm2 start main.js --name tgrss
pm2 save
pm2 startup
```

## WebSub（PubSubHubbub）サポート

リアルタイム更新を受け取るためのWebhookエンドポイント:

```
http://example.com/hubbub?feed=https://example.com/feed
```

WebSubに対応しているブログプラットフォームからのリアルタイム通知を受け取ることができます。

## トラブルシューティング

- **ボットがコマンドに反応しない**: ボットがチャンネル管理者であることを確認
- **RSSの解析エラー**: URLが有効なRSSフィードであることを確認
- **新着記事通知がない**: 最後のチェック以降に新着記事があるか確認

## ライセンス

MIT

## 貢献

プルリクエストや問題報告は歓迎します！

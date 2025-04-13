const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const Parser = require("rss-parser");
const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
require("dotenv").config();

// 環境変数からトークンを取得
const token = process.env.TELEGRAM_BOT_TOKEN;
// ホスト名の設定（外部からアクセスするためのドメイン）
const HOST_DOMAIN = process.env.HOST_DOMAIN || "http://localhost";
const EXTERNAL_PORT = process.env.EXTERNAL_PORT || PORT;
// 完全な外部URLの構築（ポート番号が80または443の場合は表示しない）
const getExternalUrl = (path) => {
  const portPart =
    EXTERNAL_PORT == 80 || EXTERNAL_PORT == 443 ? "" : `:${EXTERNAL_PORT}`;
  return `${HOST_DOMAIN}${portPart}${path}`;
};

// ボットとサービスの初期化
const bot = new TelegramBot(token, { polling: true });
let botInfo = null; // ボット情報を保存する変数
const parser = new Parser();
const app = express();
const PORT = process.env.PORT || 3000;

// データベースファイルのパス
const dbFilePath = path.join(__dirname, "rss_data.db");
const db = new sqlite3.Database(dbFilePath);

// データベースの初期化
function initializeDatabase() {
  db.serialize(() => {
    // RSSフィードテーブルの作成（なければ）
    db.run(`
      CREATE TABLE IF NOT EXISTS feeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        last_check TEXT,
        last_item_guid TEXT,
        UNIQUE(chat_id, title)
      )
    `);

    // 既存のテーブルに新しいカラムを追加（存在しない場合）
    db.all("PRAGMA table_info(feeds)", (err, rows) => {
      if (err) {
        console.error("テーブル情報取得エラー:", err);
        return;
      }

      // 行が返ってきた場合のみ処理（配列として扱う）
      if (rows && Array.isArray(rows)) {
        // last_item_guidカラムの存在チェック
        const hasLastItemGuid = rows.some(
          (row) => row.name === "last_item_guid"
        );
        if (!hasLastItemGuid) {
          console.log("last_item_guidカラムを追加します");
          db.run("ALTER TABLE feeds ADD COLUMN last_item_guid TEXT");
        }
      }
    });

    console.log("データベースを初期化しました");
  });
}

// RSSフィードの追加
function addRssFeed(chatId, title, url) {
  return new Promise(async (resolve, reject) => {
    try {
      // RSSフィードを事前にパースして最新アイテムを取得
      const parsedFeed = await parser.parseURL(url);
      const latestItem = parsedFeed.items[0];
      const now = new Date().toISOString();
      const guid = latestItem
        ? latestItem.guid || latestItem.id || latestItem.link
        : "";

      db.run(
        "INSERT OR REPLACE INTO feeds (chat_id, title, url, last_check, last_item_guid) VALUES (?, ?, ?, ?, ?)",
        [chatId, title, url, now, guid],
        function (err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

// RSSフィードの削除
function removeRssFeed(chatId, title) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM feeds WHERE chat_id = ? AND title = ?",
      [chatId, title],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// チャンネルのすべてのRSSフィードを取得
function getChannelFeeds(chatId) {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM feeds WHERE chat_id = ?", [chatId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// すべてのRSSフィードを取得
function getAllFeeds() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM feeds", [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// 最終チェック時間とアイテムGUIDの更新
function updateFeedInfo(feedId, lastCheck, lastItemGuid) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE feeds SET last_check = ?, last_item_guid = ? WHERE id = ?",
      [lastCheck, lastItemGuid, feedId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// データベースを初期化
initializeDatabase();

// ボット起動時間を記録
const botStartTime = new Date();
console.log(`ボット起動時間: ${botStartTime.toISOString()}`);

// ボット情報を取得してからメッセージハンドラーを設定
bot
  .getMe()
  .then((info) => {
    botInfo = info;
    console.log(`ボット名: @${botInfo.username} が起動しました`);

    // コマンド処理
    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text || "";

      // ボットへのメンションを確認
      if (!text.includes(`@${botInfo.username}`)) return;

      // 管理者権限チェック - 実行されたチャンネルの管理者かどうか確認
      const adminStatus = await isAdmin(userId, chatId);
      if (!adminStatus) {
        return bot.sendMessage(
          chatId,
          "このコマンドはチャンネル管理者のみが実行できます。"
        );
      }

      // addコマンド: RSSフィードを追加
      if (text.includes(" add ")) {
        const parts = text.split(" add ")[1].trim().split(" ");
        if (parts.length < 2) {
          return bot.sendMessage(
            chatId,
            "使用方法: @ボット名 add タイトル名 RSSのURL"
          );
        }

        const title = parts[0];
        const rssUrl = parts[1];

        try {
          // RSSフィードが有効か確認
          await parser.parseURL(rssUrl);

          // フィードを追加
          await addRssFeed(chatId, title, rssUrl);
          bot.sendMessage(chatId, `「${title}」のRSSフィードを追加しました。`);
        } catch (error) {
          bot.sendMessage(
            chatId,
            `エラー: RSSフィードの追加に失敗しました。URLが正しいか確認してください。`
          );
          console.error(error);
        }
      }

      // removeコマンド: RSSフィードを削除
      else if (text.includes(" remove ")) {
        const title = text.split(" remove ")[1].trim();

        try {
          const deleted = await removeRssFeed(chatId, title);
          if (deleted) {
            bot.sendMessage(
              chatId,
              `「${title}」のRSSフィードを削除しました。`
            );
          } else {
            bot.sendMessage(
              chatId,
              `「${title}」というRSSフィードは登録されていません。`
            );
          }
        } catch (error) {
          bot.sendMessage(chatId, "エラー: RSSフィードの削除に失敗しました。");
          console.error(error);
        }
      }

      // listコマンド: 登録されているRSSフィードの一覧を表示
      else if (text.includes(" list")) {
        try {
          const feeds = await getChannelFeeds(chatId);

          if (feeds.length === 0) {
            return bot.sendMessage(
              chatId,
              "このチャンネルには登録されているRSSフィードがありません。"
            );
          }

          let message = "登録されているRSSフィード:\n";
          feeds.forEach((feed) => {
            message += `- ${feed.title}: ${feed.url}\n`;
          });

          bot.sendMessage(chatId, message);
        } catch (error) {
          bot.sendMessage(chatId, "エラー: フィード一覧の取得に失敗しました。");
          console.error(error);
        }
      }
    });

    // サーバー起動時に一度チェック（初回チェックフラグをtrueにして起動前の記事を通知しない）
    setTimeout(() => checkAllFeeds(true), 5000);
  })
  .catch((error) => {
    console.error("ボット情報の取得に失敗しました:", error);
    process.exit(1); // 致命的なエラーなので終了
  });

// 管理者チェック - チャンネルの管理者/モデレーターかどうかを確認
async function isAdmin(userId, chatId) {
  try {
    // グループやチャンネルの管理者一覧を取得
    const chatAdmins = await bot.getChatAdministrators(chatId);
    // 指定されたユーザーIDが管理者リストに含まれているか確認
    return chatAdmins.some((admin) => admin.user.id === userId);
  } catch (error) {
    console.error("管理者確認中にエラーが発生しました:", error);
    return false; // エラーが発生した場合は安全のためfalseを返す
  }
}

// RSSフィードをチェックする関数
async function checkRSSFeed(feed, isInitialCheck = false) {
  try {
    const parsedFeed = await parser.parseURL(feed.url);
    const lastCheck = new Date(feed.last_check);

    // 最新アイテムのGUID（または同等のID）
    const newItemsWithGuids = parsedFeed.items.map((item) => {
      return {
        ...item,
        itemGuid: item.guid || item.id || item.link,
      };
    });

    // 新しいアイテムの検出方法：
    // 1. 最後に保存したGUIDと比較
    // 2. 日付の比較（バックアップ）
    let newItems = [];

    if (feed.last_item_guid) {
      // 最後に保存したGUID以降のアイテムを新しいと見なす
      const lastGuidIndex = newItemsWithGuids.findIndex(
        (item) => item.itemGuid === feed.last_item_guid
      );
      if (lastGuidIndex !== -1) {
        newItems = newItemsWithGuids.slice(0, lastGuidIndex);
      } else {
        // 最後のGUIDが見つからない場合は日付で比較
        newItems = newItemsWithGuids.filter((item) => {
          const pubDate = new Date(item.pubDate || item.isoDate);
          return pubDate > lastCheck;
        });
      }
    } else {
      // 初回または移行時は日付で比較
      newItems = newItemsWithGuids.filter((item) => {
        const pubDate = new Date(item.pubDate || item.isoDate);
        return pubDate > lastCheck;
      });
    }

    // 初回チェック時はボット起動後の記事のみを通知
    if (isInitialCheck) {
      newItems = newItems.filter((item) => {
        const pubDate = new Date(item.pubDate || item.isoDate);
        return pubDate > botStartTime;
      });
    }

    // 新しい記事があれば通知
    if (newItems.length > 0) {
      // 最新の記事を取得（配列の先頭）
      const latestItem = newItems[0];

      // 最新5件までの記事を通知
      const itemsToSend = newItems.slice(0, 5);
      let message = `【${feed.title}】の新着記事:\n\n`;

      itemsToSend.forEach((item) => {
        message += `${item.title}\n${item.link}\n\n`;
      });

      if (newItems.length > 5) {
        message += `他 ${newItems.length - 5} 件の新着記事があります。`;
      }

      // チャンネルに送信
      await bot.sendMessage(feed.chat_id, message);

      // 最新のアイテムのGUIDと時間を保存
      await updateFeedInfo(
        feed.id,
        new Date().toISOString(),
        latestItem.itemGuid
      );

      return true;
    }

    // 更新がない場合も最終チェック時間を更新
    await updateFeedInfo(
      feed.id,
      new Date().toISOString(),
      feed.last_item_guid
    );
    return false;
  } catch (error) {
    console.error(
      `「${feed.title}」のRSSフィードの処理中にエラーが発生しました:`,
      error
    );
    return false;
  }
}

// すべてのフィードをチェック
async function checkAllFeeds(isInitialCheck = false) {
  try {
    const feeds = await getAllFeeds();
    console.log(`${feeds.length}件のRSSフィードをチェックしています...`);

    for (const feed of feeds) {
      await checkRSSFeed(feed, isInitialCheck);
      // API制限を避けるため少し間隔を空ける
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("RSSフィードのチェック中にエラーが発生しました:", error);
  }
}

// より頻繁なRSSフィードのチェック（1分ごと）
cron.schedule("* * * * *", () => checkAllFeeds(false));

// Expressサーバーの設定
app.use(express.json());
// CORS設定を追加（クロスドメインリクエストを許可）
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ヘルスチェック用のエンドポイント
app.get("/", (req, res) => {
  const info = {
    status: "running",
    serviceName: "Telegram RSS Reader Bot",
    webhookUrl: getExternalUrl("/hubbub"),
    version: "1.0.0",
  };
  res.json(info);
});

// POSTエンドポイント
app.post("/webhook", (req, res) => {
  const { chatId, message } = req.body;

  if (chatId && message) {
    bot
      .sendMessage(chatId, message)
      .then(() => res.status(200).send({ success: true }))
      .catch((error) => {
        console.error("メッセージ送信エラー:", error);
        res.status(500).send({ success: false, error: error.message });
      });
  } else {
    res
      .status(400)
      .send({ success: false, error: "chatIdとmessageが必要です" });
  }
});

// Webhookを受け取るためのエンドポイント（WebSub/PubSubHubbub対応）
app.post(
  "/hubbub",
  express.raw({ type: "application/atom+xml" }),
  async (req, res) => {
    try {
      const feedUrl = req.query.feed;
      if (!feedUrl) {
        return res.status(400).send("Feed URL required");
      }

      // 対象のフィードを検索
      db.all(
        "SELECT * FROM feeds WHERE url = ?",
        [feedUrl],
        async (err, feeds) => {
          if (err || feeds.length === 0) {
            return res.status(404).send("Feed not found");
          }

          // 各フィードをチェック
          for (const feed of feeds) {
            await checkRSSFeed(feed);
          }

          res.status(200).send("OK");
        }
      );
    } catch (error) {
      console.error("Webhook処理中にエラーが発生しました:", error);
      res.status(500).send("Error processing webhook");
    }
  }
);

// WebSub購読リクエスト用のエンドポイント
app.get("/hubbub", (req, res) => {
  const challenge = req.query["hub.challenge"];
  const mode = req.query["hub.mode"];
  const topic = req.query["hub.topic"];

  if (mode && (mode === "subscribe" || mode === "unsubscribe") && challenge) {
    console.log(`WebSub ${mode} リクエスト: ${topic}`);
    // チャレンジコードを返すことで検証に応答
    return res.status(200).send(challenge);
  }

  res.status(400).send("Bad Request");
});

// サーバーとボットの起動
app.listen(PORT, () => {
  const externalUrl = getExternalUrl("");
  console.log(`サーバーがポート${PORT}で起動しました`);
  console.log(`外部アクセスURL: ${externalUrl}`);
});

// 終了時の処理
process.on("SIGINT", () => {
  console.log("ボットを終了します...");
  db.close();
  process.exit();
});

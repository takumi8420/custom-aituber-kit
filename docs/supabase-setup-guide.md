# Supabase セットアップガイド

## 概要

AITuberKitの会話履歴を新しく作成したSupabaseプロジェクトに保存するためのセットアップ手順です。

## 実装内容

### 1. 保存先の分離

- **既存保存先**: ローカルファイル + 既存Supabaseプロジェクト（従来通り）
- **新規保存先**: 開発用Supabaseプロジェクト（新しいテーブル構造）

### 2. 新しいテーブル構造の特徴

- **感情タグ対応**: `[happy]`, `[sad]`などの感情タグを自動抽出
- **マルチモーダル対応**: テキスト、画像、JSON形式のコンテンツに対応
- **パフォーマンス最適化**: インデックス、トリガー、ビューを活用
- **拡張性**: 音声ファイル参照、ユーザータイムスタンプなど

## セットアップ手順

### 1. Supabaseプロジェクト作成

1. [Supabase](https://supabase.com)にアクセス
2. 新しいプロジェクトを作成
3. プロジェクトの設定から以下を取得：
   - **Project URL**: `https://xxx.supabase.co`
   - **Anon public**: `eyJ...`

### 2. データベーススキーマ作成

1. SupabaseダッシュボードのSQL Editorを開く
2. プロジェクトルートの`supabase-schema.sql`ファイルの内容をコピー
3. SQL Editorに貼り付けて実行

### 3. 環境変数設定

`.env`ファイルに以下を追加：

```env
# 開発用Supabase設定
SUPABASE_URL_DEV="https://your-project-id.supabase.co"
SUPABASE_ANON_KEY_DEV="your-anon-key"
```

### 4. 動作確認

1. アプリケーションを起動: `npm run dev`
2. チャットでメッセージを送信
3. ブラウザの開発者ツールでコンソールログを確認：
   ```
   [CHAT_HISTORY] save-chat-log API called: {
     messageCount: 2,
     isNewFile: false,
     timestamp: "2024-06-29T15:16:39.906Z",
     hasSupabase: true,
     hasSupabaseDev: true
   }
   ```

## データ保存フロー

```
ユーザーメッセージ送信
    ↓
Zustandストアで管理
    ↓
2秒デバウンス後
    ↓
/api/save-chat-log 呼び出し
    ↓
┌─────────────────┬─────────────────┐
│  ローカルファイル │  既存Supabase   │
│  (JSON形式)     │  (従来テーブル)  │
└─────────────────┴─────────────────┘
    ↓
新しいSupabaseプロジェクト
(拡張テーブル構造)
```

## 保存されるデータ例

### local_chat_sessions テーブル

| id | title | created_at | updated_at | message_count | last_message_at |
|---|---|---|---|---|---|
| uuid-1 | log_2024-06-29T15-16-39.json | 2024-06-29T15:16:39Z | 2024-06-29T15:16:45Z | 2 | 2024-06-29T15:16:45Z |

### local_messages テーブル

| message_id | session_id | role | content | content_type | emotion_tag | user_timestamp |
|---|---|---|---|---|---|---|
| msg_abc123 | uuid-1 | user | 元気ですか？ | text | null | 2024-06-29T15:16:39Z |
| msg_def456 | uuid-1 | assistant | [happy]うん、元気だよ！ | text | happy | null |

## ログ出力の確認

### 成功時のログ

```
[CHAT_HISTORY] save-chat-log API called: {...}
[CHAT_HISTORY] Messages to save: {...}
[CHAT_HISTORY] Saving to file: {...}
[CHAT_HISTORY] Saving to Supabase database...
[CHAT_HISTORY] Successfully saved to Supabase
[CHAT_HISTORY] Saving to Development Supabase database...
[CHAT_HISTORY] Dev session lookup result: {...}
[CHAT_HISTORY] Creating new dev session for file: log_xxx.json
[CHAT_HISTORY] New dev session created: uuid-xxx
[CHAT_HISTORY] Inserting messages to dev database: {...}
[CHAT_HISTORY] Successfully saved to Development Supabase
[CHAT_HISTORY] Chat log saved successfully
```

### エラー時の対処

1. **接続エラー**: 環境変数の確認
2. **テーブル存在エラー**: SQLスキーマの再実行
3. **権限エラー**: Anon keyの確認
4. **データ型エラー**: メッセージ構造の確認

## データ分析例

### セッション一覧取得

```sql
SELECT * FROM latest_chat_sessions LIMIT 10;
```

### 感情分析

```sql
SELECT 
  emotion_tag,
  COUNT(*) as message_count,
  COUNT(DISTINCT session_id) as session_count
FROM local_messages 
WHERE role = 'assistant' AND emotion_tag IS NOT NULL
GROUP BY emotion_tag
ORDER BY message_count DESC;
```

### 会話パターン分析

```sql
SELECT 
  s.title,
  COUNT(m.id) as total_messages,
  COUNT(CASE WHEN m.role = 'user' THEN 1 END) as user_messages,
  COUNT(CASE WHEN m.role = 'assistant' THEN 1 END) as assistant_messages,
  MAX(m.created_at) - MIN(m.created_at) as conversation_duration
FROM local_chat_sessions s
LEFT JOIN local_messages m ON s.id = m.session_id
GROUP BY s.id, s.title
ORDER BY total_messages DESC;
```

## トラブルシューティング

### よくある問題

1. **環境変数が読み込まれない**
   - `.env`ファイルの場所確認
   - サーバー再起動

2. **テーブルが見つからない**
   - SQLスキーマの実行確認
   - テーブル名の確認

3. **データが保存されない**
   - コンソールログでエラー確認
   - Supabaseダッシュボードでデータ確認

### デバッグ方法

```javascript
// ブラウザコンソールで確認
console.log('[CHAT_HISTORY]'); // ログフィルタリング

// 保存状況の確認
fetch('/api/save-chat-log', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    messages: [{
      id: 'test-id',
      role: 'user',
      content: 'テスト',
      timestamp: new Date().toISOString()
    }]
  })
}).then(r => r.json()).then(console.log);
```

## メンテナンス

### 定期実行推奨

```sql
-- 古いセッションのクリーンアップ（30日以上古い）
SELECT cleanup_old_sessions(30);

-- テーブル統計の更新
ANALYZE local_chat_sessions;
ANALYZE local_messages;
```

### 監視項目

- データベースサイズ
- クエリパフォーマンス
- エラーログの頻度
- 感情タグの分布

## 次のステップ

1. **分析ダッシュボード**: Grafana/Metabaseでの可視化
2. **アラート設定**: エラー率の監視
3. **バックアップ**: 定期的なデータエクスポート
4. **拡張機能**: 検索、レポート生成など
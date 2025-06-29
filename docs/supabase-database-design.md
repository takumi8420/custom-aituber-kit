# AITuberKit Supabase Database Design

## 概要

AITuberKitの会話履歴を管理するためのSupabaseデータベース設計ドキュメント。

## テーブル構成

### 1. local_chat_sessions テーブル

チャットセッション（ログファイル単位）を管理するテーブル。

**カラム構成:**

| カラム名 | データ型 | 制約 | 説明 |
|---------|---------|------|------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | セッションの一意識別子 |
| title | TEXT | NOT NULL, UNIQUE | ファイル名（例: log_2024-06-29T15-16-39.json） |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | セッション作成日時 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | セッション更新日時 |
| message_count | INTEGER | DEFAULT 0 | メッセージ数（パフォーマンス用） |
| last_message_at | TIMESTAMPTZ | - | 最後のメッセージ送信日時 |

**インデックス:**
- `idx_local_chat_sessions_title` (title)
- `idx_local_chat_sessions_created_at` (created_at DESC)
- `idx_local_chat_sessions_updated_at` (updated_at DESC)

### 2. local_messages テーブル

個別のメッセージを管理するテーブル。

**カラム構成:**

| カラム名 | データ型 | 制約 | 説明 |
|---------|---------|------|------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | メッセージの一意識別子 |
| message_id | TEXT | UNIQUE, NOT NULL | アプリケーション側で生成されるメッセージID |
| session_id | UUID | NOT NULL, FOREIGN KEY | セッションへの参照 |
| role | TEXT | NOT NULL, CHECK | メッセージの役割（user, assistant, system, code） |
| content | TEXT | NOT NULL | メッセージ内容（JSON形式も可） |
| content_type | TEXT | DEFAULT 'text', CHECK | コンテンツタイプ（text, multimodal, json） |
| emotion_tag | TEXT | - | 感情タグ（happy, sad, neutral等） |
| audio_id | TEXT | - | 音声ファイルID（将来的な拡張用） |
| user_timestamp | TIMESTAMPTZ | - | ユーザー側設定のタイムスタンプ |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | サーバー側記録の作成日時 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新日時 |

**インデックス:**
- `idx_local_messages_session_id` (session_id)
- `idx_local_messages_message_id` (message_id)
- `idx_local_messages_role` (role)
- `idx_local_messages_created_at` (created_at DESC)
- `idx_local_messages_session_created` (session_id, created_at DESC)

## トリガー機能

### 1. セッション自動更新

メッセージが挿入されると、関連するセッションの以下が自動更新されます：
- `updated_at`: 現在時刻
- `message_count`: 該当セッションのメッセージ数
- `last_message_at`: 最新メッセージの作成時刻

### 2. メッセージ更新日時

メッセージが更新されると`updated_at`が自動で現在時刻に設定されます。

## ビュー

### 1. latest_chat_sessions ビュー

最新のセッション一覧を取得するビュー。プレビュー機能付き。

```sql
SELECT * FROM latest_chat_sessions ORDER BY updated_at DESC LIMIT 10;
```

### 2. session_messages ビュー

セッション内のメッセージを詳細表示するビュー。メッセージ順序付き。

```sql
SELECT * FROM session_messages WHERE session_id = 'セッションID' ORDER BY message_order;
```

## データフロー

```
1. ユーザーがメッセージ送信
   ↓
2. フロントエンド（Zustand）でメッセージ管理
   ↓
3. 2秒のデバウンス後、/api/save-chat-log APIが呼び出し
   ↓
4. ローカルファイル（JSON）に保存
   ↓
5. Supabaseデータベースに保存
   - セッション存在確認・作成
   - メッセージ挿入
   - トリガーによる自動更新
```

## パフォーマンス最適化

### 1. インデックス戦略
- セッション検索用のタイトルインデックス
- 時系列検索用の日付インデックス
- 複合インデックスによる効率的なクエリ

### 2. データクリーンアップ

古いデータの定期削除機能：

```sql
SELECT cleanup_old_sessions(30); -- 30日より古いセッションを削除
```

### 3. ビューによるクエリ最適化

よく使用されるクエリパターンをビューとして事前定義。

## セキュリティ

### Row Level Security (RLS)

必要に応じてRLSを有効化可能：

```sql
ALTER TABLE local_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_messages ENABLE ROW LEVEL SECURITY;
```

## 環境変数設定

以下の環境変数が必要：

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## セットアップ手順

1. Supabaseプロジェクト作成
2. `supabase-schema.sql`を実行
3. 環境変数を設定
4. アプリケーション起動

## 拡張性

### 将来的な拡張案

1. **マルチモーダル対応**: 画像・音声ファイルの参照機能
2. **ユーザー管理**: マルチユーザー対応
3. **分析機能**: 会話パターン分析
4. **エクスポート機能**: データの外部出力
5. **検索機能**: 全文検索対応

### スケーラビリティ

- パーティショニング（日付ベース）
- レプリケーション設定
- キャッシュ戦略（Redis等）

## トラブルシューティング

### よくある問題

1. **メッセージ重複**: `message_id`のUNIQUE制約で防止
2. **タイムスタンプ不整合**: トリガーによる自動管理
3. **パフォーマンス問題**: インデックスとビューで最適化

### ログ確認

アプリケーションのコンソールで`[CHAT_HISTORY]`タグでログ確認可能：

```javascript
// ブラウザの開発者ツールで確認
console.log('[CHAT_HISTORY]');
```

## 監視・メンテナンス

### 定期実行推奨

```sql
-- 月次実行: 古いデータのクリーンアップ
SELECT cleanup_old_sessions(90);

-- 統計情報の更新
ANALYZE local_chat_sessions;
ANALYZE local_messages;
```

### 監視項目

- テーブルサイズ
- インデックス使用率
- クエリパフォーマンス
- エラーログ
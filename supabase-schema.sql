-- AITuberKit Supabase Database Schema
-- Chat Log Management Tables

-- =====================================================
-- 1. Chat Sessions Table
-- =====================================================
CREATE TABLE IF NOT EXISTS local_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL UNIQUE, -- ファイル名（例: log_2024-06-29T15-16-39.json）
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    message_count INTEGER DEFAULT 0, -- パフォーマンス用のカウンタ
    last_message_at TIMESTAMPTZ, -- 最後のメッセージ時刻
    
    -- インデックス
    CONSTRAINT valid_title CHECK (length(title) > 0)
);

-- セッションテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_local_chat_sessions_title ON local_chat_sessions(title);
CREATE INDEX IF NOT EXISTS idx_local_chat_sessions_created_at ON local_chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_chat_sessions_updated_at ON local_chat_sessions(updated_at DESC);

-- =====================================================
-- 2. Messages Table
-- =====================================================
CREATE TABLE IF NOT EXISTS local_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id TEXT UNIQUE NOT NULL, -- アプリケーション側で生成されるメッセージID
    session_id UUID NOT NULL REFERENCES local_chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'code')),
    content TEXT NOT NULL, -- JSON形式の場合もあり
    content_type TEXT DEFAULT 'text' CHECK (content_type IN ('text', 'multimodal', 'json')), -- コンテンツタイプ
    emotion_tag TEXT, -- 感情タグ（例: happy, sad, neutral）
    audio_id TEXT, -- 音声ファイルのID（将来的な拡張用）
    user_timestamp TIMESTAMPTZ, -- ユーザー側で設定されたタイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- サーバー側で記録される作成時刻
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- 更新時刻（ストリーミング中の更新用）
    
    -- 制約
    CONSTRAINT valid_content CHECK (length(content) > 0),
    CONSTRAINT valid_role CHECK (length(role) > 0)
);

-- メッセージテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_local_messages_session_id ON local_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_local_messages_message_id ON local_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_local_messages_role ON local_messages(role);
CREATE INDEX IF NOT EXISTS idx_local_messages_created_at ON local_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_messages_session_created ON local_messages(session_id, created_at DESC);

-- =====================================================
-- 3. Triggers for Automatic Updates
-- =====================================================

-- セッションの updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION update_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE local_chat_sessions 
    SET 
        updated_at = now(),
        message_count = (
            SELECT COUNT(*) 
            FROM local_messages 
            WHERE session_id = NEW.session_id
        ),
        last_message_at = NEW.created_at
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- メッセージ挿入時にセッションを更新
CREATE TRIGGER trigger_update_session_on_message_insert
    AFTER INSERT ON local_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_session_timestamp();

-- メッセージの updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION update_message_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_timestamp
    BEFORE UPDATE ON local_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_message_timestamp();

-- =====================================================
-- 4. Views for Easy Querying
-- =====================================================

-- 最新のセッション一覧ビュー
CREATE OR REPLACE VIEW latest_chat_sessions AS
SELECT 
    s.id,
    s.title,
    s.created_at,
    s.updated_at,
    s.message_count,
    s.last_message_at,
    -- 最初のユーザーメッセージをプレビューとして取得
    COALESCE(
        (SELECT LEFT(content, 100) 
         FROM local_messages 
         WHERE session_id = s.id AND role = 'user' 
         ORDER BY created_at ASC 
         LIMIT 1), 
        'No messages'
    ) as preview
FROM local_chat_sessions s
ORDER BY s.updated_at DESC;

-- セッション内のメッセージ詳細ビュー
CREATE OR REPLACE VIEW session_messages AS
SELECT 
    m.id,
    m.message_id,
    m.session_id,
    s.title as session_title,
    m.role,
    m.content,
    m.content_type,
    m.emotion_tag,
    m.audio_id,
    m.user_timestamp,
    m.created_at,
    m.updated_at,
    -- メッセージの順序
    ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.created_at) as message_order
FROM local_messages m
JOIN local_chat_sessions s ON m.session_id = s.id
ORDER BY m.session_id, m.created_at;

-- =====================================================
-- 5. Row Level Security (RLS) - Optional
-- =====================================================

-- RLSを有効化（必要に応じて）
-- ALTER TABLE local_chat_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE local_messages ENABLE ROW LEVEL SECURITY;

-- 基本的なポリシー例（全てのユーザーが読み書き可能）
-- CREATE POLICY "Allow all operations" ON local_chat_sessions FOR ALL USING (true);
-- CREATE POLICY "Allow all operations" ON local_messages FOR ALL USING (true);

-- =====================================================
-- 6. Initial Data / Test Data (Optional)
-- =====================================================

-- 初期データの挿入例
-- INSERT INTO local_chat_sessions (title) VALUES ('test-session-' || extract(epoch from now()));

-- =====================================================
-- 7. Performance Optimization
-- =====================================================

-- 古いデータの自動削除関数（オプション）
CREATE OR REPLACE FUNCTION cleanup_old_sessions(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM local_chat_sessions 
    WHERE updated_at < now() - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 定期実行用（手動実行）
-- SELECT cleanup_old_sessions(30); -- 30日より古いセッションを削除
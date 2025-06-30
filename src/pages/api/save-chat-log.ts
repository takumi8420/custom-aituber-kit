import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { Message } from '@/features/messages/messages'

// 感情タグを抽出する関数
const extractEmotionTag = (content: string): string | null => {
  if (typeof content !== 'string') return null
  const emotionMatch = content.match(/^\s*\[(.*?)\]/)
  return emotionMatch ? emotionMatch[1].toLowerCase() : null
}

// コンテンツタイプを判定する関数
const getContentType = (content: Message['content']): string => {
  if (typeof content === 'string') return 'text'
  if (Array.isArray(content)) return 'multimodal'
  return 'json'
}

// Supabaseクライアントの初期化（既存のプロダクション用）
let supabase: SupabaseClient | null = null
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// 開発用Supabaseクライアントの初期化
let supabaseDev: SupabaseClient | null = null
if (process.env.SUPABASE_URL_DEV && process.env.SUPABASE_ANON_KEY_DEV) {
  supabaseDev = createClient(
    process.env.SUPABASE_URL_DEV!,
    process.env.SUPABASE_ANON_KEY_DEV!
  )
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { messages: newMessages, isNewFile } = req.body as {
      messages: Message[]
      isNewFile?: boolean
    }
    const currentTime = new Date().toISOString()

    console.log('[CHAT_HISTORY] save-chat-log API called:', {
      messageCount: newMessages?.length || 0,
      isNewFile: !!isNewFile,
      timestamp: currentTime,
      hasSupabase: !!supabase,
      hasSupabaseDev: !!supabaseDev,
    })

    if (!Array.isArray(newMessages) || newMessages.length === 0) {
      console.log('[CHAT_HISTORY] Invalid messages data received')
      return res.status(400).json({ message: 'Invalid messages data' })
    }

    console.log('[CHAT_HISTORY] Messages to save:', {
      messages: newMessages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        contentPreview:
          typeof msg.content === 'string'
            ? msg.content.substring(0, 100) +
              (msg.content.length > 100 ? '...' : '')
            : '[object]',
        timestamp: msg.timestamp,
      })),
    })

    const logsDir = path.join(process.cwd(), 'logs')

    // logsディレクトリが存在しない場合は作成
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir)
    }

    // isNewFile が true の場合は強制的に新しいファイルを作成
    const fileName = isNewFile
      ? `log_${currentTime.replace(/[:.]/g, '-')}.json`
      : getLatestLogFile(logsDir) ||
        `log_${currentTime.replace(/[:.]/g, '-')}.json`

    const filePath = path.join(logsDir, fileName)

    // ファイルの読み込みと更新
    let existingMessages: Message[] = []
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        existingMessages = JSON.parse(fileContent)
        if (!Array.isArray(existingMessages)) {
          console.warn(`Invalid format in ${fileName}, resetting file.`)
          existingMessages = []
        }
      } catch (parseError) {
        console.error(`Error parsing ${fileName}, resetting file.`, parseError)
        existingMessages = []
      }
    }

    // 新しいメッセージを既存のメッセージに追加
    const allMessages = [...existingMessages, ...newMessages]

    console.log('[CHAT_HISTORY] Saving to file:', {
      filePath,
      existingMessageCount: existingMessages.length,
      newMessageCount: newMessages.length,
      totalMessageCount: allMessages.length,
    })

    // 更新されたメッセージ配列を保存
    fs.writeFileSync(filePath, JSON.stringify(allMessages, null, 2))

    if (supabase) {
      console.log('[CHAT_HISTORY] Saving to Supabase database...')
      const { data: existingSession } = await supabase
        .from('local_chat_sessions')
        .select('id')
        .eq('title', fileName)
        .maybeSingle()

      let sessionId = existingSession?.id
      console.log('[CHAT_HISTORY] Session lookup result:', {
        fileName,
        existingSessionId: sessionId || 'none',
      })

      if (sessionId) {
        console.log('[CHAT_HISTORY] Updating existing session:', sessionId)
        await supabase
          .from('local_chat_sessions')
          .update({ updated_at: currentTime })
          .eq('id', sessionId)
      } else {
        console.log('[CHAT_HISTORY] Creating new session for file:', fileName)
        const { data: newSession, error: sessionError } = await supabase
          .from('local_chat_sessions')
          .insert({
            title: fileName,
            created_at: currentTime,
            updated_at: currentTime,
          })
          .select('id')
          .single()

        if (sessionError) {
          console.error('[CHAT_HISTORY] Session creation error:', sessionError)
          throw sessionError
        }
        sessionId = newSession.id
        console.log('[CHAT_HISTORY] New session created:', sessionId)
      }

      const messagesToSave = newMessages.map((msg) => ({
        session_id: sessionId,
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
        created_at: msg.timestamp || currentTime,
      }))

      console.log('[CHAT_HISTORY] Inserting messages to database:', {
        sessionId,
        messageCount: messagesToSave.length,
      })

      const { error: messageError } = await supabase
        .from('local_messages')
        .insert(messagesToSave)

      if (messageError) {
        console.error('[CHAT_HISTORY] Message insertion error:', messageError)
        throw messageError
      }

      console.log('[CHAT_HISTORY] Successfully saved to Supabase')
    }

    // 開発用Supabaseへの保存（新しいテーブル構造）
    if (supabaseDev) {
      console.log('[CHAT_HISTORY] Saving to Development Supabase database...')

      try {
        // セッションの存在確認・作成
        const { data: existingDevSession } = await supabaseDev
          .from('local_chat_sessions')
          .select('id')
          .eq('title', fileName)
          .maybeSingle()

        let devSessionId = existingDevSession?.id
        console.log('[CHAT_HISTORY] Dev session lookup result:', {
          fileName,
          existingSessionId: devSessionId || 'none',
        })

        if (devSessionId) {
          console.log(
            '[CHAT_HISTORY] Updating existing dev session:',
            devSessionId
          )
          const { error: updateError } = await supabaseDev
            .from('local_chat_sessions')
            .update({ updated_at: currentTime })
            .eq('id', devSessionId)

          if (updateError) {
            console.error(
              '[CHAT_HISTORY] Dev session update error:',
              updateError
            )
            throw updateError
          }
        } else {
          console.log(
            '[CHAT_HISTORY] Creating new dev session for file:',
            fileName
          )
          const { data: newDevSession, error: sessionError } = await supabaseDev
            .from('local_chat_sessions')
            .insert({
              title: fileName,
              created_at: currentTime,
              updated_at: currentTime,
            })
            .select('id')
            .single()

          if (sessionError) {
            console.error(
              '[CHAT_HISTORY] Dev session creation error:',
              sessionError
            )
            throw sessionError
          }
          devSessionId = newDevSession.id
          console.log('[CHAT_HISTORY] New dev session created:', devSessionId)
        }

        // メッセージを新しいテーブル構造で保存
        const devMessagesToSave = newMessages.map((msg) => {
          const contentStr =
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content)

          const emotionTag = extractEmotionTag(contentStr)
          const contentType = getContentType(msg.content)

          return {
            message_id:
              msg.id ||
              `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            session_id: devSessionId,
            role: msg.role,
            content: contentStr,
            content_type: contentType,
            emotion_tag: emotionTag,
            audio_id: msg.audio?.id || null,
            user_timestamp: msg.timestamp || null,
            created_at: currentTime,
            updated_at: currentTime,
          }
        })

        console.log('[CHAT_HISTORY] Inserting messages to dev database:', {
          sessionId: devSessionId,
          messageCount: devMessagesToSave.length,
          messageTypes: devMessagesToSave.map((m) => ({
            role: m.role,
            contentType: m.content_type,
            emotionTag: m.emotion_tag,
            hasAudio: !!m.audio_id,
          })),
        })

        const { error: messageError } = await supabaseDev
          .from('local_messages')
          .insert(devMessagesToSave)

        if (messageError) {
          console.error(
            '[CHAT_HISTORY] Dev message insertion error:',
            messageError
          )
          throw messageError
        }

        console.log('[CHAT_HISTORY] Successfully saved to Development Supabase')

        // Send request to auto-comment endpoint after successful insert
        if (process.env.NEXT_PUBLIC_YOUTUBE_LIVE_ID) {
          try {
            console.log('[CHAT_HISTORY] Sending auto-comment request...')
            const autoCommentResponse = await fetch(
              'http://13.231.143.248:5000/youtube/auto-comment',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  video_id: process.env.NEXT_PUBLIC_YOUTUBE_LIVE_ID,
                }),
              }
            )

            if (!autoCommentResponse.ok) {
              console.error(
                '[CHAT_HISTORY] Auto-comment request failed:',
                autoCommentResponse.status,
                autoCommentResponse.statusText
              )
            } else {
              console.log(
                '[CHAT_HISTORY] Auto-comment request sent successfully'
              )
            }
          } catch (autoCommentError) {
            console.error(
              '[CHAT_HISTORY] Error sending auto-comment request:',
              autoCommentError
            )
          }
        }
      } catch (devError) {
        console.error(
          '[CHAT_HISTORY] Development Supabase save error:',
          devError
        )
        // 開発用データベースのエラーはログ出力のみで、メイン処理は継続
      }
    }

    console.log('[CHAT_HISTORY] Chat log saved successfully')
    res.status(200).json({ message: 'Logs saved successfully' })
  } catch (error) {
    console.error('[CHAT_HISTORY] Error saving chat log:', error)
    res.status(500).json({ message: 'Error saving chat log' })
  }
}

function getLatestLogFile(dir: string): string | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('log_') && f.endsWith('.json'))
      .sort()
      .reverse()
    return files.length > 0 ? files[0] : null
  } catch (error) {
    console.error('Error reading log directory:', error)
    return null
  }
}

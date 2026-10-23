// Сервер Пинка v2: голосовая диагностика (позже — планировщик пинков и push)
const express = require('express')
const multer = require('multer')
const { createClient } = require('@supabase/supabase-js')
const OpenAI = require('openai')
const { toFile } = require('openai')
const { INVISIBLE_CARDS } = require('./cards')
require('dotenv').config()

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env
const STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1'
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini'

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/', (_req, res) => res.json({ ok: true, service: 'pinok' }))

// Пользователь по токену Supabase из приложения
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'unauthorized' })
  req.userId = data.user.id
  next()
}

async function householdOf(userId, householdId) {
  const { data } = await admin.from('household_members')
    .select('household_id').eq('user_id', userId).eq('household_id', householdId).maybeSingle()
  if (!data) return null
  const { data: rows } = await admin.from('household_members')
    .select('role, profiles(id, display_name)').eq('household_id', householdId)
  return (rows || []).map((r) => ({ id: r.profiles.id, name: r.profiles.display_name, role: r.role }))
}

const SYSTEM = `Ты помогаешь семейному приложению «Пинок» сделать невидимый домашний труд видимым.
Пользователь голосом рассказал о своей обычной неделе по дому. Разложи рассказ на отдельные домашние дела.

Правила:
- Каждое дело — короткое, 2–5 слов, с заглавной буквы («Собрать ребёнка в садик»).
- Обязательно выделяй НЕВИДИМЫЕ дела: заметить, помнить, проверить, спланировать, решить, напомнить,
  договориться, следить. Например «по дороге думаю, что купить на ужин» → «Решить, что на ужин» (invisible: true).
  «Саша выносит мусор, если напомню» → два дела: «Вынести мусор» (кто — Саша) и «Напоминать про мусор» (кто — рассказчик, invisible: true).
- who: имя члена семьи из списка, "me" для рассказчика, null если непонятно. Если человек говорит «я»/«мне» — это "me".
- per_week: сколько раз в неделю (каждый день = 7, по будням = 5, раз в неделю = 1, раз в месяц = 0.25).
- freq: "daily" | "weekdays" | "weekly" | "monthly" | "rarely".
- emoji: одна подходящая эмодзи.
- stock: список того, что у них обычно заканчивается (продукты, бытовое), если упомянуто. Короткие названия.
- covered: ключи карточек из списка ниже, которые УЖЕ упомянуты в рассказе (чтобы не спрашивать повторно).

Ответ — только JSON:
{"items":[{"title":"","who":"me","freq":"daily","per_week":7,"invisible":false,"emoji":""}],"stock":[""],"covered":[""]}`

// POST /diagnosis/parse  (multipart: audio, household_id) → { transcript, items, stock, covered }
app.post('/diagnosis/parse', auth, upload.single('audio'), async (req, res) => {
  try {
    const members = await householdOf(req.userId, req.body.household_id)
    if (!members) return res.status(403).json({ error: 'forbidden' })

    let transcript = (req.body.text || '').trim()
    if (req.file) {
      const file = await toFile(req.file.buffer, req.file.originalname || 'voice.m4a', { type: req.file.mimetype })
      const tr = await openai.audio.transcriptions.create({ file, model: STT_MODEL, language: 'ru' })
      transcript = (tr.text || '').trim()
    }
    if (!transcript) return res.status(400).json({ error: 'empty' })

    const me = members.find((m) => m.id === req.userId)
    const others = members.filter((m) => m.id !== req.userId)
    const cards = INVISIBLE_CARDS.map((c) => `${c.key}: ${c.title}`).join('\n')

    const out = await openai.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content:
          `Рассказчик: ${me?.name || 'я'}\nДругие члены семьи: ${others.map((m) => `${m.name} (${m.role === 'child' ? 'ребёнок' : 'взрослый'})`).join(', ') || 'не указаны'}\n` +
          `Карточки:\n${cards}\n\nРассказ:\n"""${transcript}"""` },
      ],
    })
    const parsed = JSON.parse(out.choices[0].message.content || '{}')

    // Имена → id членов семьи
    const byName = (name) => {
      if (!name) return null
      if (name === 'me') return req.userId
      const n = name.toLowerCase()
      return members.find((m) => m.name.toLowerCase() === n || m.name.toLowerCase().startsWith(n) || n.startsWith(m.name.toLowerCase()))?.id ?? null
    }
    const items = (parsed.items || []).filter((i) => i && i.title).map((i) => ({
      title: String(i.title).slice(0, 80),
      who: byName(i.who),
      freq: i.freq || 'weekly',
      per_week: Math.max(0, Math.min(Number(i.per_week) || 1, 21)),
      invisible: !!i.invisible,
      emoji: i.emoji || null,
      source: 'voice',
    }))
    res.json({
      transcript,
      items,
      stock: (parsed.stock || []).filter(Boolean).slice(0, 40),
      covered: (parsed.covered || []).filter((k) => INVISIBLE_CARDS.some((c) => c.key === k)),
    })
  } catch (e) {
    console.error('diagnosis/parse', e)
    res.status(500).json({ error: 'parse_failed' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Пинок сервер на порту ${PORT}`))

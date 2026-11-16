// Supabase Edge Function: голосовая диагностика (docs/PRODUCT.md §8, шаг 5)
// POST JSON: { household_id, text? , audio_path? (Storage voice/…) } → { transcript, items, stock, covered }
// Секрет: OPENAI_API_KEY (Supabase → Edge Functions → Secrets).
// SUPABASE_URL / SUPABASE_ANON_KEY Supabase подставляет сам.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { decodeBase64 } from 'jsr:@std/encoding@1/base64'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const STT_MODEL = Deno.env.get('OPENAI_STT_MODEL') ?? 'whisper-1'
const TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-4o-mini'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

async function stt(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('model', STT_MODEL)
  fd.append('language', 'ru')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: fd,
  })
  if (!r.ok) throw new Error(`stt ${r.status}: ${await r.text()}`)
  return ((await r.json()).text ?? '').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // Клиент от имени пользователя: RLS сам проверит, что он член семьи
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth.user?.id
    if (!userId) return json({ error: 'unauthorized' }, 401)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const { data: rows } = await supabase.from('household_members')
      .select('role, profiles(id, display_name)').eq('household_id', householdId)
    const members = (rows ?? []).map((r: any) => ({ id: r.profiles.id, name: r.profiles.display_name, role: r.role }))
    if (!members.some((m) => m.id === userId)) return json({ error: 'forbidden' }, 403)

    // Голос → текст. Запись лежит в Storage (voice/<user>/<файл>), рядом сохраняем расшифровку <файл>.txt:
    // если разбор упадёт, при повторе Whisper второй раз не нужен и рассказ не потеряется
    let transcript = String(body.text ?? '').trim()
    const audioPath = body.audio_path ? String(body.audio_path) : null
    if (audioPath) {
      if (!audioPath.startsWith(`${userId}/`)) return json({ error: 'forbidden' }, 403)
      const saved = await supabase.storage.from('voice').download(`${audioPath}.txt`)
      if (saved.data) transcript = (await saved.data.text()).trim()
      if (!transcript) {
        const { data: blob, error } = await supabase.storage.from('voice').download(audioPath)
        if (error || !blob) throw new Error(`download: ${error?.message}`)
        const name = audioPath.split('/').pop() || 'voice.m4a'
        transcript = await stt(new File([blob], name, { type: 'audio/mp4' }))
        if (transcript) {
          await supabase.storage.from('voice')
            .upload(`${audioPath}.txt`, transcript, { contentType: 'text/plain; charset=utf-8', upsert: true })
        }
      }
    } else if (body.audio_base64) {
      // старые версии приложения
      const name = String(body.audio_name || 'voice.m4a')
      transcript = await stt(new File([decodeBase64(body.audio_base64)], name, { type: 'audio/mp4' }))
    }
    if (!transcript) return json({ error: 'empty' }, 400)

    // Текст → дела
    const me = members.find((m) => m.id === userId)
    const others = members.filter((m) => m.id !== userId)
    // Карточки «Это тоже ты?» — из базы (таблица invisible_cards), с учётом «что есть дома»
    const { data: cardRows } = await supabase.rpc('cards_for', { p_household: householdId })
    const cardKeys = new Set((cardRows ?? []).map((c: any) => c.key))
    const cards = (cardRows ?? []).map((c: any) => `${c.key}: ${c.title}`).join('\n')
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content:
            `Рассказчик: ${me?.name ?? 'я'}\nДругие члены семьи: ${others.map((m) => `${m.name} (${m.role === 'child' ? 'ребёнок' : 'взрослый'})`).join(', ') || 'не указаны'}\n` +
            `Карточки:\n${cards}\n\nРассказ:\n"""${transcript}"""` },
        ],
      }),
    })
    if (!r.ok) throw new Error(`chat ${r.status}: ${await r.text()}`)
    const parsed = JSON.parse((await r.json()).choices[0].message.content || '{}')

    // Имена → id членов семьи
    const byName = (name: string | null) => {
      if (!name) return null
      if (name === 'me') return userId
      const n = name.toLowerCase()
      return members.find((m) => m.name.toLowerCase() === n || m.name.toLowerCase().startsWith(n) || n.startsWith(m.name.toLowerCase()))?.id ?? null
    }
    const items = (parsed.items ?? []).filter((i: any) => i?.title).map((i: any) => ({
      title: String(i.title).slice(0, 80),
      who: byName(i.who),
      freq: i.freq || 'weekly',
      per_week: Math.max(0, Math.min(Number(i.per_week) || 1, 21)),
      invisible: !!i.invisible,
      emoji: i.emoji || null,
      source: 'voice',
    }))
    return json({
      transcript,
      items,
      stock: (parsed.stock ?? []).filter(Boolean).slice(0, 40),
      covered: (parsed.covered ?? []).filter((k: string) => cardKeys.has(k)),
    })
  } catch (e) {
    console.error('diagnosis-parse', e)
    const msg = String((e as Error)?.message ?? e)
    return json({ error: msg.startsWith('stt') ? 'Не удалось расшифровать голос' : msg.startsWith('chat') ? 'Не удалось разложить на дела' : 'Ошибка разбора', detail: msg.slice(0, 300) }, 500)
  }
})

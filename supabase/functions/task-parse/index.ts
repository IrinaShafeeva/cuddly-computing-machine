// Supabase Edge Function: дело голосом
// «Саше завтра к семи вынести мусор и протереть ведро» → заполненная форма дела
// POST JSON: { household_id, audio_path? (Storage voice/<user>/…), text?, now: '2026-11-16 14:05, понедельник', mode?: 'task' | 'guide' }
// task  → { transcript, title, notes, icon, assignee, repeat, days, n, month_day, day_offset, due_time, guide_id }
// guide → { transcript, title, icon, place, steps: string[] }
// Секрет: OPENAI_API_KEY (тот же, что для диагностики).
import { createClient } from 'npm:@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const STT_MODEL = Deno.env.get('OPENAI_STT_MODEL') ?? 'whisper-1'
const TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-4o-mini'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SYSTEM = `Ты помогаешь семейному приложению «Пинок» быстро создать ОДНО домашнее дело из голосового сообщения.
Человек надиктовал, что надо сделать, кому и когда. Заполни форму дела.

Поля:
- title: коротко, 2–6 слов, с заглавной буквы, без имени исполнителя и без времени («Вынести мусор»).
- notes: подробности из сообщения — как именно, где, что важно (своими словами, коротко). Пусто, если подробностей нет.
- icon: одна эмодзи по смыслу.
- who: имя исполнителя из списка семьи, "me" если «я сама / себе / мне надо», null если не сказано.
- repeat: "once" (один раз) | "daily" (каждый день) | "weekly" (по дням недели) | "every_n_days" | "monthly".
- days: для weekly — номера дней, 0 = понедельник … 6 = воскресенье («по выходным» = [5,6], «по будням» = [0,1,2,3,4]).
- n: для every_n_days — через сколько дней.
- month_day: для monthly — число месяца.
- day_offset: для once — через сколько дней от сегодня (сегодня = 0, завтра = 1, «в пятницу» — посчитай от текущей даты). Если не сказано — 0.
- due_time: "ЧЧ:ММ" к какому времени, если сказано («к семи вечера» = "19:00", «утром» = "09:00", «днём» = "13:00», «вечером» = "21:00»). null если не сказано.
- guide: номер гида из списка гидов семьи, если дело явно про него («по гиду», «как в гиде», или дело про ту же вещь — «поменять губку» и гид «Губка для посуды»). null, если не подходит ни один.

Ответ — только JSON:
{"title":"","notes":"","icon":"","who":null,"repeat":"once","days":[],"n":2,"month_day":1,"day_offset":0,"due_time":null,"guide":null}`

const GUIDE_SYSTEM = `Ты помогаешь семейному приложению «Пинок» записать ГИД — короткую домашнюю инструкцию: где что лежит и как это делать.
Человек надиктовал голосом. Разложи по полям.

Поля:
- title: что это, 2–5 слов, с заглавной буквы («Губка для посуды», «Как включить посудомойку»).
- icon: одна эмодзи по смыслу.
- place: где лежит / где находится, коротко («под раковиной, слева»). Пусто, если не сказано.
- steps: шаги по порядку, каждый — одно короткое понятное действие своими словами. Без нумерации. Если шагов нет — [].

Ответ — только JSON:
{"title":"","icon":"","place":"","steps":[]}`

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
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth.user?.id
    if (!userId) return json({ error: 'unauthorized' }, 401)

    const body = await req.json()
    const householdId = String(body.household_id ?? '')
    const { data: rows } = await supabase.from('household_members')
      .select('role, profiles(id, display_name, is_placeholder)').eq('household_id', householdId)
    const members = (rows ?? []).map((r: any) => ({ id: r.profiles.id, name: r.profiles.display_name as string, role: r.role }))
    if (!members.some((m) => m.id === userId)) return json({ error: 'forbidden' }, 403)

    let transcript = String(body.text ?? '').trim()
    const audioPath = body.audio_path ? String(body.audio_path) : null
    if (audioPath) {
      if (!audioPath.startsWith(`${userId}/`)) return json({ error: 'forbidden' }, 403)
      const { data: blob, error } = await supabase.storage.from('voice').download(audioPath)
      if (error || !blob) throw new Error(`download: ${error?.message}`)
      transcript = await stt(new File([blob], audioPath.split('/').pop() || 'task.m4a', { type: 'audio/mp4' }))
      // запись дела больше не нужна
      await supabase.storage.from('voice').remove([audioPath])
    }
    if (!transcript) return json({ error: 'Ничего не услышала — скажи ещё раз' }, 400)

    const ask = async (system: string, user: string) => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL, temperature: 0.1, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      })
      if (!r.ok) throw new Error(`chat ${r.status}: ${await r.text()}`)
      return JSON.parse((await r.json()).choices[0].message.content || '{}')
    }

    // ── Гид голосом ──
    if (body.mode === 'guide') {
      const g = await ask(GUIDE_SYSTEM, `Сообщение:\n"""${transcript}"""`)
      return json({
        transcript,
        title: String(g.title || transcript).slice(0, 80),
        icon: g.icon || null,
        place: String(g.place || '').slice(0, 200),
        steps: (Array.isArray(g.steps) ? g.steps : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 15),
      })
    }

    const { data: guideRows } = await supabase.from('guides').select('id, title').eq('household_id', householdId).order('title')
    const guides = guideRows ?? []

    const me = members.find((m) => m.id === userId)
    const others = members.filter((m) => m.id !== userId)
    const p = await ask(SYSTEM,
      `Сейчас: ${String(body.now ?? new Date().toISOString())}\nГоворит: ${me?.name ?? 'я'}\n` +
      `Семья: ${others.map((m) => `${m.name} (${m.role === 'child' ? 'ребёнок' : 'взрослый'})`).join(', ') || 'никого'}\n` +
      `Гиды: ${guides.map((g, i) => `${i + 1}. ${g.title}`).join('; ') || 'нет'}\n\n` +
      `Сообщение:\n"""${transcript}"""`)

    const byName = (name: string | null) => {
      if (!name) return null
      if (name === 'me') return userId
      const n = name.toLowerCase().slice(0, 4)
      return members.find((m) => m.name.toLowerCase().startsWith(n) || n.startsWith(m.name.toLowerCase().slice(0, 4)))?.id ?? null
    }
    const repeat = ['once', 'daily', 'weekly', 'every_n_days', 'monthly'].includes(p.repeat) ? p.repeat : 'once'
    const time = typeof p.due_time === 'string' && /^\d{1,2}:\d{2}$/.test(p.due_time) ? p.due_time.padStart(5, '0') : null
    return json({
      transcript,
      title: String(p.title || transcript).slice(0, 80),
      notes: String(p.notes || '').slice(0, 500),
      icon: p.icon || null,
      assignee: byName(p.who),
      repeat,
      days: (Array.isArray(p.days) ? p.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6),
      n: Math.max(1, Math.min(Number(p.n) || 2, 60)),
      month_day: Math.max(1, Math.min(Number(p.month_day) || 1, 31)),
      day_offset: Math.max(0, Math.min(Number(p.day_offset) || 0, 365)),
      due_time: time,
      guide_id: Number.isInteger(Number(p.guide)) ? guides[Number(p.guide) - 1]?.id ?? null : null,
    })
  } catch (e) {
    console.error('task-parse', e)
    const msg = String((e as Error)?.message ?? e)
    return json({ error: msg.startsWith('stt') ? 'Не удалось расшифровать голос' : 'Не удалось разобрать', detail: msg.slice(0, 300) }, 500)
  }
})

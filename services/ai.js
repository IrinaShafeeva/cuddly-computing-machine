/**
 * AI-парсеры для бота Пинок.
 * parseScheduleFromText — «Как часто?» (частота + время + даты)
 * parseReminderTimes — «В какое время?» (следующий шаг после выбора частоты)
 * parseOnceFromText — «Когда напомнить?» для разовых задач (25 декабря, завтра, через неделю)
 * parseVoiceTask — голосовое сообщение → задача
 */
const OpenAI = require('openai')

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

async function parseReminderTimes(text, frequency = 'daily') {
  if (!openai) {
    return parseReminderTimesFallback(text, frequency)
  }
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты парсер расписания напоминаний. Возвращай только валидный JSON без markdown.
Форматы reminder_times:
- daily: {"type":"daily","hour":8,"minute":0}
- interval: {"type":"interval","every_hours":3,"from_hour":9,"to_hour":21}
- every_n_days: {"type":"every_n_days","n":3,"hour":10,"minute":0}
- weekly: {"type":"weekly","days":[1,3,5],"hour":10,"minute":0} (0=вс,1=пн,...,6=сб)
- once: {"type":"once","at":"2024-12-20T10:00:00Z"}
"вечером" = 19:00, "утром" = 8:00.`
        },
        {
          role: 'user',
          content: `Частота: ${frequency}. Текст пользователя: "${text}". Верни JSON массив reminder_times.`
        }
      ],
      temperature: 0.2
    })
    const content = res.choices[0]?.message?.content?.trim()
    if (!content) return []
    const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, ''))
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (e) {
    console.error('AI parse error:', e)
    return parseReminderTimesFallback(text, frequency)
  }
}

function parseReminderTimesFallback(text, frequency) {
  const result = []
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/)
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10)
    const minute = parseInt(timeMatch[2], 10)
    if (frequency === 'daily') result.push({ type: 'daily', hour, minute })
    else if (frequency === 'weekly') result.push({ type: 'weekly', days: [1, 2, 3, 4, 5], hour, minute })
    else result.push({ type: 'daily', hour, minute })
  } else {
    result.push({ type: 'daily', hour: 9, minute: 0 })
  }
  return result
}

async function parseVoiceTask(transcribedText) {
  if (!openai) {
    return {
      assignee_hint: 'не указано',
      title: transcribedText,
      due_hint: 'не указано',
      reminder_hint: 'не указано'
    }
  }
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты помощник для семейного бота напоминаний.
Из голосового сообщения извлеки задачу и верни JSON:
{
  "assignee_hint": "кому адресована задача (имя или роль)",
  "title": "что нужно сделать",
  "due_hint": "когда (текстом)",
  "reminder_hint": "как часто напоминать (текстом)"
}
Верни только JSON без пояснений.`
        },
        {
          role: 'user',
          content: `Голосовое сообщение: "${transcribedText}"`
        }
      ],
      temperature: 0.2
    })
    const content = res.choices[0]?.message?.content?.trim()
    if (!content) throw new Error('Empty response')
    return JSON.parse(content.replace(/```json?\s*|\s*```/g, ''))
  } catch (e) {
    console.error('Voice parse error:', e)
    return {
      assignee_hint: 'не указано',
      title: transcribedText || 'Задача',
      due_hint: 'не указано',
      reminder_hint: 'не указано'
    }
  }
}

async function parseScheduleFromText(text) {
  if (!openai) {
    return parseScheduleFallback(text)
  }
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты парсер расписания напоминаний для семейного бота. Пользователь пишет как часто напоминать. Верни JSON:
{
  "frequency": "daily" | "weekly" | "every_2_days" | "custom" | "once",
  "reminder_times": [массив объектов],
  "days_of_week": [1,2,3] для weekly (0=вс,1=пн,...,6=сб),
  "due_date": "ISO дата" только для once,
  "need_more": null | "time" | "days"
}

Форматы reminder_times:
- daily: {"type":"daily","hour":8,"minute":0}
- interval: {"type":"interval","every_hours":3,"from_hour":9,"to_hour":21}
- every_n_days: {"type":"every_n_days","n":3,"hour":10,"minute":0}
- weekly: {"type":"weekly","days":[1,5],"hour":10,"minute":0}
- once: {"type":"once","at":"2024-12-20T10:00:00Z"}

"вечером"=19:00, "утром"=8:00. ВАЖНО: НЕ придумывай время. Если пользователь написал только "каждый день" или "раз в неделю" без времени — need_more="time", reminder_times=[]. Для once: "25 декабря в 10", "завтра" — парси. need_more="days" если weekly но дни не указаны. Верни только JSON.`
        },
        {
          role: 'user',
          content: `Текст пользователя: "${text}"`
        }
      ],
      temperature: 0.2
    })
    const content = res.choices[0]?.message?.content?.trim()
    if (!content) return parseScheduleFallback(text)
    const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, ''))
    return {
      frequency: parsed.frequency || 'daily',
      reminder_times: Array.isArray(parsed.reminder_times) ? parsed.reminder_times : [],
      days_of_week: Array.isArray(parsed.days_of_week) ? parsed.days_of_week : [],
      due_date: parsed.due_date || null,
      need_more: parsed.need_more || null
    }
  } catch (e) {
    console.error('AI schedule parse error:', e)
    return parseScheduleFallback(text)
  }
}

function parseScheduleFallback(text) {
  const t = (text || '').toLowerCase()
  if (/один раз|разово/.test(t) && !/в день|день/.test(t)) {
    return { frequency: 'once', reminder_times: [], days_of_week: [], due_date: null, need_more: 'time' }
  }
  if (/раз в неделю|еженедельно/.test(t)) {
    return { frequency: 'weekly', reminder_times: [], days_of_week: [], due_date: null, need_more: 'days' }
  }
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/)
  const hour = timeMatch ? parseInt(timeMatch[1], 10) : 9
  const minute = timeMatch ? parseInt(timeMatch[2], 10) : 0
  return {
    frequency: 'daily',
    reminder_times: [{ type: 'daily', hour, minute }],
    days_of_week: [],
    due_date: null,
    need_more: null
  }
}

async function parseOnceFromText(text) {
  if (!openai) return parseOnceFallback(text)
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Парсер даты/времени для разового напоминания. Пользователь пишет когда напомнить. Верни JSON:
{"reminder_times": [{"type":"once","at":"ISO8601"}], "due_date": "ISO8601"}
Примеры: "25 декабря в 10" -> at с сегодняшним годом, "завтра вечером" -> 19:00, "через неделю" -> +7 дней 9:00, "в пятницу" -> ближайшая пятница. Верни только JSON.`
        },
        { role: 'user', content: `Текст: "${text}". Текущая дата: ${new Date().toISOString().split('T')[0]}` }
      ],
      temperature: 0.2
    })
    const content = res.choices[0]?.message?.content?.trim()
    if (!content) return parseOnceFallback(text)
    const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, ''))
    return {
      reminder_times: Array.isArray(parsed.reminder_times) ? parsed.reminder_times : [{ type: 'once', at: parsed.due_date || new Date().toISOString() }],
      due_date: parsed.due_date || null
    }
  } catch (e) {
    console.error('AI parseOnce error:', e)
    return parseOnceFallback(text)
  }
}

function parseOnceFallback(text) {
  const m = (text || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(\d{1,2})?:?(\d{2})?/)
  if (m) {
    const [, day, month, year, h, min] = m
    const hour = h ? parseInt(h, 10) : 9
    const minute = min ? parseInt(min, 10) : 0
    const d = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10), hour, minute)
    return { reminder_times: [{ type: 'once', at: d.toISOString() }], due_date: d.toISOString() }
  }
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return { reminder_times: [{ type: 'once', at: d.toISOString() }], due_date: d.toISOString() }
}

/**
 * Один запрос — вся задача. Парсит "Мама, купить хлеб каждый день в 9" в полную структуру.
 */
async function parseFullTask(text, memberNames = []) {
  if (!openai) {
    return parseFullTaskFallback(text, memberNames)
  }
  const namesStr = memberNames.length ? memberNames.join(', ') : ''
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты парсер задач для семейного бота. Пользователь пишет ВСЁ ОДНИМ СООБЩЕНИЕМ: кому, что сделать, когда напоминать.
Верни JSON:
{
  "assignee_hint": "имя из текста (мама, папа, Петя и т.д.) или null если не указано",
  "title": "что сделать",
  "frequency": "daily"|"weekly"|"every_2_days"|"custom"|"once",
  "reminder_times": [{"type":"daily","hour":9,"minute":0} и т.д.],
  "days_of_week": [1,2,3] для weekly (0=вс,1=пн,...,6=сб),
  "due_date": "ISO8601" только для once
}

Форматы reminder_times: daily, interval, weekly, once. "вечером"=19, "утром"=8.
Если время не указано — daily 9:00. Если "раз в неделю" без дней — days_of_week=[1] (пн).
Члены семьи: ${namesStr}. assignee_hint должен совпадать с именем.
Верни только JSON.`
        },
        {
          role: 'user',
          content: `Текст: "${text}". Сегодня: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.2
    })
    const content = res.choices[0]?.message?.content?.trim()
    if (!content) return parseFullTaskFallback(text, memberNames)
    const parsed = JSON.parse(content.replace(/```json?\s*|\s*```/g, ''))
    return {
      assignee_hint: parsed.assignee_hint || null,
      title: parsed.title || text,
      frequency: parsed.frequency || 'once',
      reminder_times: Array.isArray(parsed.reminder_times) ? parsed.reminder_times : [],
      days_of_week: Array.isArray(parsed.days_of_week) ? parsed.days_of_week : [],
      due_date: parsed.due_date || null
    }
  } catch (e) {
    console.error('parseFullTask error:', e)
    return parseFullTaskFallback(text, memberNames)
  }
}

function parseFullTaskFallback(text, memberNames) {
  const t = (text || '').trim()
  const parts = t.split(/[,—–-]/).map(p => p.trim()).filter(Boolean)
  let assignee_hint = null
  let rest = t
  if (parts.length >= 2 && memberNames.length) {
    const first = parts[0].toLowerCase()
    const match = memberNames.find(n => n.toLowerCase().includes(first) || first.includes(n.toLowerCase()))
    if (match) {
      assignee_hint = match
      rest = parts.slice(1).join(' ').trim() || parts[0]
    }
  }
  const timeMatch = rest.match(/(\d{1,2}):(\d{2})/)
  const hour = timeMatch ? parseInt(timeMatch[1], 10) : 9
  const minute = timeMatch ? parseInt(timeMatch[2], 10) : 0
  return {
    assignee_hint,
    title: rest || t,
    frequency: 'daily',
    reminder_times: [{ type: 'daily', hour, minute }],
    days_of_week: [],
    due_date: null
  }
}

module.exports = { parseReminderTimes, parseVoiceTask, parseScheduleFromText, parseOnceFromText, parseFullTask }

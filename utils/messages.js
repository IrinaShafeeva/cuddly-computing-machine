const DEFAULT_REQUEST_TEMPLATE = '[имя], можешь взять \'[задача]\'? [причина]'

const formatRequestTemplate = (template, name, task, reason) => {
  const t = template || DEFAULT_REQUEST_TEMPLATE
  return t
    .replace(/\[имя\]/g, name)
    .replace(/\[задача\]/g, task)
    .replace(/\[причина\]/g, reason)
}

const formatReminderTimes = (reminderTimes) => {
  if (!reminderTimes || !Array.isArray(reminderTimes) || reminderTimes.length === 0) {
    return 'Не указано'
  }
  return reminderTimes.map(r => {
    if (r.type === 'daily') return `${String(r.hour).padStart(2, '0')}:${String(r.minute || 0).padStart(2, '0')}`
    if (r.type === 'interval') return `каждые ${r.every_hours} ч с ${r.from_hour} до ${r.to_hour}`
    if (r.type === 'every_n_days') return `каждые ${r.n} дня в ${String(r.hour).padStart(2, '0')}:${String(r.minute || 0).padStart(2, '0')}`
    if (r.type === 'weekly') {
      const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
      const d = (r.days || []).map(x => days[x]).join(', ')
      return `${d} в ${String(r.hour).padStart(2, '0')}:${String(r.minute || 0).padStart(2, '0')}`
    }
    if (r.type === 'once') return new Date(r.at).toLocaleString('ru-RU')
    return JSON.stringify(r)
  }).join(', ')
}

const formatSchedule = (task) => {
  const parts = []
  if (task.frequency === 'daily') parts.push('Каждый день')
  if (task.frequency === 'every_2_days') parts.push('Через день')
  if (task.frequency === 'weekly') parts.push('Раз в неделю')
  if (task.frequency === 'custom') parts.push('Свой интервал')
  if (task.frequency === 'once') parts.push('Один раз')
  if (task.due_date) parts.push(`до ${new Date(task.due_date).toLocaleDateString('ru-RU')}`)
  return parts.join(', ') || 'Не указано'
}

const ERROR_MESSAGE = 'Упс, что-то пошло не так. Попробуй ещё раз или напиши /start'

const DONE_RESPONSES = [
  'Красавчик! 👍',
  'Записал. +1 к семейному балансу',
  'Готово!',
  'Отлично!'
]

const EMPTY_TASKS = 'Пока ничего. Отдыхай ☕'

const REMINDER_PREFIX = 'Пинок: '

const SNOOZE_1H = 'Напомню через час ⏰'
const SNOOZE_EVENING = 'Напомню вечером 🌙'
const REJECTED = 'Понятно. Может в другой раз?'
const NO_ONE_TO_ASK = 'Некого попросить — в семье только ты или дети 😅'
const TASK_SENT = (name) => `Готово, отправила ${name}.`

const ADD_TASK_PROMPT = `Кому, что и когда? Пиши или наговаривай голосом.

Примеры:
• Мама, купить хлеб каждый день в 9
• Папа, вынести мусор по понедельникам
• Завтра в 18 — молоко, Петя`

function getDoneResponse() {
  return DONE_RESPONSES[Math.floor(Math.random() * DONE_RESPONSES.length)]
}

module.exports = {
  DEFAULT_REQUEST_TEMPLATE,
  formatRequestTemplate,
  formatReminderTimes,
  formatSchedule,
  ERROR_MESSAGE,
  getDoneResponse,
  EMPTY_TASKS,
  REMINDER_PREFIX,
  SNOOZE_1H,
  SNOOZE_EVENING,
  REJECTED,
  NO_ONE_TO_ASK,
  TASK_SENT,
  ADD_TASK_PROMPT
}

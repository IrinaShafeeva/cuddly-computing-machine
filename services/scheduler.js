const cron = require('node-cron')
const { supabase } = require('../db/supabase')
const { reminderKeyboard } = require('../utils/keyboards')
const { REMINDER_PREFIX } = require('../utils/messages')

const SNOOZE_BUFFER_MINUTES = 50

function shouldSendReminder(task, local, lastSent) {
  const times = task.reminder_times || []
  if (times.length === 0) return false

  const hour = local.hour
  const minute = local.minute
  const dayOfWeek = local.dayOfWeek
  const today = local.date

  for (const r of times) {
    if (r.type === 'daily') {
      if (r.hour === hour && (r.minute || 0) === minute) return true
    }
    if (r.type === 'interval') {
      const from = r.from_hour || 0
      const to = r.to_hour || 23
      const every = r.every_hours || 1
      if (hour >= from && hour <= to && hour % every === 0 && minute === 0) return true
    }
    if (r.type === 'every_n_days') {
      const created = new Date(task.created_at)
      const nowUtc = new Date()
      const daysSince = Math.floor((nowUtc - created) / (1000 * 60 * 60 * 24))
      if (daysSince % (r.n || 1) === 0 && r.hour === hour && (r.minute || 0) === minute) return true
    }
    if (r.type === 'weekly') {
      const days = r.days || []
      if (days.includes(dayOfWeek) && r.hour === hour && (r.minute || 0) === minute) return true
    }
    if (r.type === 'once') {
      const at = new Date(r.at)
      const nowUtc = new Date()
      if (at <= nowUtc && at.toISOString().split('T')[0] === today) return true
    }
  }
  return false
}

// Принимает объект лога целиком, чтобы проверять и snoozed_until
function wasSentRecently(lastLog) {
  if (!lastLog) return false
  // Активный снуз: пользователь явно откладывал до конкретного времени
  if (lastLog.snoozed_until && new Date(lastLog.snoozed_until) > new Date()) return true
  // Обычный буфер: не слать повторно раньше SNOOZE_BUFFER_MINUTES
  if (!lastLog.sent_at) return false
  const diff = (Date.now() - new Date(lastLog.sent_at).getTime()) / (1000 * 60)
  return diff < SNOOZE_BUFFER_MINUTES
}

function getLocalTime(utcDate, timezone) {
  const tz = timezone || 'Europe/Moscow'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      weekday: 'short'
    }).formatToParts(utcDate)
    const get = (type) => parts.find(p => p.type === type)?.value || '0'
    const weekdayNum = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')] ?? 0
    return {
      hour: parseInt(get('hour'), 10),
      minute: parseInt(get('minute'), 10),
      dayOfWeek: weekdayNum,
      date: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`
    }
  } catch {
    return { hour: utcDate.getUTCHours(), minute: utcDate.getUTCMinutes(), dayOfWeek: utcDate.getUTCDay(), date: utcDate.toISOString().split('T')[0] }
  }
}

async function runReminders(bot) {
  if (!supabase) return
  const now = new Date()

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, family_id, reminder_times, created_at')
    .eq('is_active', true)
    .eq('status', 'accepted')

  const { data: families } = await supabase.from('families').select('id, timezone').in('id', [...new Set((tasks || []).map(t => t.family_id))])
  const tzByFamily = {}
  for (const f of families || []) tzByFamily[f.id] = f.timezone || 'Europe/Moscow'

  for (const task of tasks || []) {
    const local = getLocalTime(now, tzByFamily[task.family_id])
    if (!shouldSendReminder(task, local, null)) continue

    const { data: logs } = await supabase
      .from('reminders_log')
      .select('sent_at, snoozed_until')
      .eq('task_id', task.id)
      .eq('user_id', task.assigned_to)
      .order('sent_at', { ascending: false })
      .limit(1)

    if (wasSentRecently(logs?.[0])) continue

    const { data: assignee } = await supabase.from('users').select('telegram_id').eq('id', task.assigned_to).single()
    if (!assignee?.telegram_id) continue

    try {
      await bot.telegram.sendMessage(
        assignee.telegram_id,
        REMINDER_PREFIX + task.title,
        reminderKeyboard(task.id).reply_markup
      )
      await supabase.from('reminders_log').insert({
        task_id: task.id,
        user_id: task.assigned_to
      })
    } catch (e) {
      console.error('Reminder send error:', e)
    }
  }
}

function startScheduler(bot) {
  cron.schedule('* * * * *', () => runReminders(bot))
}

module.exports = { startScheduler, runReminders }

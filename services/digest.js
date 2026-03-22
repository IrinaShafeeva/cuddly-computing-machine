const cron = require('node-cron')
const { supabase } = require('../db/supabase')
const { getEffectivePlan } = require('./subscription')

function getDayOfWeek(tz) {
  try {
    const w = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date())
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[w] ?? 0
  } catch {
    return new Date().getUTCDay()
  }
}

function isTaskRelevantToday(task, today, dayOfWeek) {
  if (task.frequency === 'once') return task.due_date && String(task.due_date).startsWith(today)
  if (task.frequency === 'weekly' && task.days_of_week?.length) return task.days_of_week.includes(dayOfWeek)
  if (task.frequency === 'every_2_days' || task.frequency === 'daily') return true
  return true
}

async function sendDigest(bot) {
  if (!supabase) return

  const { data: families } = await supabase.from('families').select('*')

  for (const family of families || []) {
    const plan = getEffectivePlan(family)
    if (!plan.digest) continue

    const digestHour = family.digest_hour ?? 21
    const tz = family.timezone || 'Europe/Moscow'
    let localHour
    try {
      localHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()), 10)
    } catch {
      localHour = new Date().getUTCHours()
    }
    if (localHour !== digestHour) continue

    let today
    try {
      today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\//g, '-')
    } catch {
      today = new Date().toISOString().split('T')[0]
    }
    const dayOfWeek = getDayOfWeek(tz)

    const { data: completions } = await supabase
      .from('task_completions')
      .select('completed_by, task_id, tasks(title)')
      .eq('family_id', family.id)
      .eq('date', today)

    const completedTaskIds = new Set((completions || []).map(c => c.task_id))
    const byUserDone = {}
    for (const c of completions || []) {
      const uid = c.completed_by
      if (!byUserDone[uid]) byUserDone[uid] = []
      if (c.tasks?.title) byUserDone[uid].push(c.tasks.title)
    }

    const { data: allTasks } = await supabase
      .from('tasks')
      .select('id, title, assigned_to')
      .eq('family_id', family.id)
      .eq('is_active', true)
      .eq('status', 'accepted')

    const byUserUndone = {}
    for (const t of allTasks || []) {
      if (!isTaskRelevantToday(t, today, dayOfWeek)) continue
      if (completedTaskIds.has(t.id)) continue
      const uid = t.assigned_to
      if (!byUserUndone[uid]) byUserUndone[uid] = []
      byUserUndone[uid].push(t.title)
    }

    const { data: members } = await supabase.from('users').select('id, name, telegram_id').eq('family_id', family.id)
    let msg = `Пинок вечером — как прошёл день?\n\n${family.name} сегодня:\n\n`
    let totalDone = 0
    for (const m of members || []) {
      const done = byUserDone[m.id] || []
      const undone = byUserUndone[m.id] || []
      totalDone += done.length
      if (done.length > 0 || undone.length > 0) {
        const doneStr = done.length ? ('✓ ' + done.join(', ')) : ''
        const undoneStr = undone.length ? undone.map(function (t) { return '"' + t + '" ещё ждёт'; }).join('\n  ') : ''
        msg += m.name + ':\n'
        if (doneStr) msg += '  ' + doneStr + '\n'
        if (undoneStr) msg += '  ' + undoneStr + '\n'
        msg += '\n'
      } else {
        msg += m.name + ': ничего не было запланировано — отдыхай!\n\n'
      }
    }

    const closing = totalDone > 0
      ? `\n${totalDone} дел за день. Семья справилась! 👏`
      : '\nЗавтра будет лучше 💪'
    msg += closing

    for (const m of members || []) {
      try {
        await bot.telegram.sendMessage(m.telegram_id, msg)
      } catch (e) {
        console.error('Digest send error:', e)
      }
    }
  }
}

function startDigest(bot) {
  cron.schedule('0 * * * *', () => sendDigest(bot))
}

module.exports = { startDigest, sendDigest }

const { supabase } = require('../db/supabase')
const { Markup } = require('telegraf')
const { formatReminderTimes } = require('../utils/messages')
const { ERROR_MESSAGE } = require('../utils/messages')
const { getUserWithFamily } = require('../utils/db')

async function sendFamilyStatus(ctx) {
  const user = await getUserWithFamily(ctx)
  if (!user || !user.family_id) {
    await ctx.reply('Сначала создай или присоединись к семье.')
    return
  }
  const family = user.families || (await supabase.from('families').select('*').eq('id', user.family_id).single()).data
  if (!family) {
    await ctx.reply(ERROR_MESSAGE)
    return
  }
  const { data: members } = await supabase.from('users').select('id, name').eq('family_id', family.id)
  const today = new Date().toISOString().split('T')[0]
  const { data: completionsToday } = await supabase.from('task_completions').select('completed_by, task_id').eq('family_id', family.id).eq('date', today)
  const taskIds = [...new Set((completionsToday || []).map(c => c.task_id))]
  const { data: taskTitles } = taskIds.length ? await supabase.from('tasks').select('id, title').in('id', taskIds) : { data: [] }
  const titleByTask = {}
  for (const t of taskTitles || []) titleByTask[t.id] = t.title
  const byUser = {}
  for (const m of members || []) byUser[m.id] = { name: m.name, tasks: [] }
  for (const c of completionsToday || []) {
    const uid = c.completed_by
    if (byUser[uid] && titleByTask[c.task_id]) byUser[uid].tasks.push(titleByTask[c.task_id])
  }
  let msg = `${family.name}\n\n— Сегодня —\n`
  for (const m of members || []) {
    const t = byUser[m.id]?.tasks || []
    msg += `${m.name}: ${t.length ? t.join(', ') : 'ничего пока'}\n`
  }
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const { data: tasks } = await supabase.from('tasks').select('id, title, assigned_to, reminder_times, frequency, days_of_week').eq('family_id', family.id).eq('is_active', true).eq('status', 'accepted')
  const { data: completionsWeek } = await supabase.from('task_completions').select('task_id, date').eq('family_id', family.id).gte('completed_at', weekAgo.toISOString())
  const completionByTask = {}
  for (const c of completionsWeek || []) {
    if (!completionByTask[c.task_id]) completionByTask[c.task_id] = []
    completionByTask[c.task_id].push(c.date)
  }
  msg += '\n— Регулярные задачи — (за последние 7 дней)\n\n'
  const byAssignee = {}
  for (const t of tasks || []) {
    const aid = t.assigned_to
    if (!byAssignee[aid]) byAssignee[aid] = []
    byAssignee[aid].push(t)
  }
  for (const m of members || []) {
    const list = byAssignee[m.id] || []
    if (list.length === 0) continue
    msg += `${m.name}\n`
    for (const t of list) {
      const dates = [...new Set((completionByTask[t.id] || []).map(d => d))].length
      let expected = 7
      if (t.frequency === 'weekly' && t.days_of_week?.length) expected = t.days_of_week.length
      else if (t.frequency === 'every_2_days') expected = 3
      const bar = '█'.repeat(Math.min(dates, 7)) + '░'.repeat(Math.max(0, 7 - dates))
      msg += `  ${t.title}     ${bar}  ${dates}/${expected}\n`
    }
    msg += '\n'
  }
  await ctx.reply(msg.trim())
}

module.exports = function (bot) {
  // sendFamilyStatus экспортируется ниже для использования в callbacks.js

  bot.command('family', async (ctx) => {
    try {
      await sendFamilyStatus(ctx)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.hears('Семья', async (ctx) => {
    try {
      await sendFamilyStatus(ctx)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.command('settings', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      const family = user.families || (await supabase.from('families').select('*').eq('id', user.family_id).single()).data
      await ctx.reply(
        'Настройки:\n' +
        'Время дайджеста: ' + (family?.digest_hour ?? 21) + ':00\n' +
        'Часовой пояс: ' + (family?.timezone || 'Europe/Moscow') + '\n\n' +
        'Изменение настроек — в следующей версии.'
      )
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.command('invite', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      const family = user.families || (await supabase.from('families').select('*').eq('id', user.family_id).single()).data
      if (!family) {
        await ctx.reply(ERROR_MESSAGE)
        return
      }
      const botInfo = await ctx.telegram.getMe()
      const link = `https://t.me/${botInfo.username}?start=join_${family.invite_code}`
      await ctx.reply('Пригласи нового члена семьи по ссылке:\n' + link)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })
}

module.exports.sendFamilyStatus = sendFamilyStatus

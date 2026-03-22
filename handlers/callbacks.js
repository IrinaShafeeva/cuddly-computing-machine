const { supabase } = require('../db/supabase')
const { getUserWithFamily } = require('../utils/db')
const {
  taskActionKeyboard,
  acceptReminderKeyboard,
  acceptReminderAddKeyboard,
  reminderKeyboard,
  askOtherKeyboard,
  confirmAskKeyboard,
  takeTaskKeyboard,
  askOtherRetryKeyboard,
  discussionOrganizerKeyboard,
  statsKeyboard
} = require('../utils/keyboards')
const {
  formatRequestTemplate,
  formatReminderTimes,
  ERROR_MESSAGE,
  getDoneResponse,
  EMPTY_TASKS,
  SNOOZE_1H,
  SNOOZE_EVENING,
  REJECTED,
  NO_ONE_TO_ASK,
  TASK_SENT,
  ADD_TASK_PROMPT
} = require('../utils/messages')
const { parseScheduleFromText, parseOnceFromText } = require('../services/ai')

// Возвращает UTC ISO для targetHour:00 сегодня в указанном TZ.
// Если время уже прошло — возвращает завтра.
function getTimeInTzAsUtc(tz, targetHour) {
  try {
    const now = new Date()
    const todayInTz = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now).replace(/\//g, '-')

    // Стартуем с targetHour:00 UTC и корректируем по разнице
    let guess = new Date(`${todayInTz}T${String(targetHour).padStart(2, '0')}:00:00Z`)
    const actualHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(guess), 10
    )
    guess = new Date(guess.getTime() + (targetHour - actualHour) * 60 * 60 * 1000)
    // Если уже прошло — следующий день
    if (guess <= now) guess = new Date(guess.getTime() + 24 * 60 * 60 * 1000)
    return guess.toISOString()
  } catch {
    const d = new Date()
    d.setUTCHours(Math.max(0, targetHour - 3), 0, 0, 0)
    if (d <= new Date()) d.setDate(d.getDate() + 1)
    return d.toISOString()
  }
}

// Строит сообщение статистики. since=null → за всё время, since=Date → с даты.
async function buildStatsMessage(familyId, family, since = null) {
  let query = supabase
    .from('task_completions')
    .select('completed_by, original_assignee, task_id')
    .eq('family_id', familyId)
  if (since) query = query.gte('completed_at', since.toISOString())
  const { data: heroes } = await query

  const helpOthers = (heroes || []).filter(h => h.completed_by !== h.original_assignee)
  const taskIds = [...new Set(helpOthers.map(h => h.task_id))]
  const { data: taskTitles } = taskIds.length
    ? await supabase.from('tasks').select('id, title').in('id', taskIds)
    : { data: [] }
  const titleByTask = {}
  for (const t of taskTitles || []) titleByTask[t.id] = t.title

  const byUser = {}
  for (const h of helpOthers) {
    const uid = h.completed_by
    if (!byUser[uid]) byUser[uid] = { count: 0, tasks: [] }
    byUser[uid].count++
    if (titleByTask[h.task_id]) byUser[uid].tasks.push(titleByTask[h.task_id])
  }
  const { data: users } = await supabase.from('users').select('id, name').eq('family_id', familyId)
  const sorted = (users || [])
    .map(u => ({ ...u, ...byUser[u.id] }))
    .filter(x => x.count)
    .sort((a, b) => (b.count || 0) - (a.count || 0))

  const period = since ? 'за этот месяц' : 'за всё время'
  let msg = `${family?.name || 'Семья'} — герои ${period}\n\nКто чаще всего выручал:\n\n`
  if (sorted.length === 0) {
    return msg + 'Пока никто никому не помогал. Попроси кого-нибудь взять задачу!'
  }
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    msg += `${i + 1}. ${s.name}    ${'█'.repeat(s.count || 0)}  ${s.count} раз\n`
  }
  msg += '\nЗа что выручали:\n'
  for (const s of sorted) {
    const byTask = {}
    for (const t of s.tasks || []) byTask[t] = (byTask[t] || 0) + 1
    const parts = Object.entries(byTask).map(([t, c]) => `${t} (${c})`).join(', ')
    msg += `${s.name}: ${parts}\n`
  }
  return msg
}

module.exports = function (bot) {
  // ─── Текстовые multi-step флоу ────────────────────────────────────────────

  bot.on('text', async (ctx, next) => {
    const session = ctx.session || {}
    const text = ctx.message.text?.trim()

    // Причина для «попросить другого»
    if (session.askOther?.step === 'reason') {
      session.askOther.reason = text
      session.askOther.step = 'confirm'
      const { data: task } = await supabase.from('tasks').select('title').eq('id', session.askOther.taskId).single()
      const { data: target } = await supabase.from('users').select('name').eq('id', session.askOther.targetUserId).single()
      const user = await getUserWithFamily(ctx)
      const preview = formatRequestTemplate(null, user?.name || '', task?.title || '', text)
      await ctx.reply(
        `${target?.name || 'Получатель'} получит:\n\n«${preview}»\n\nОтправить?`,
        confirmAskKeyboard(session.askOther.taskId).reply_markup
      )
      return
    }

    // Обсуждение задачи — пересылка организатору
    if (session.step === 'discuss_message' && session.discussTaskId) {
      const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', session.discussTaskId).single()
      const { data: creator } = task
        ? await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        : { data: null }
      if (creator?.telegram_id) {
        const user = await getUserWithFamily(ctx)
        await ctx.telegram.sendMessage(
          creator.telegram_id,
          `${user?.name || 'Кто-то'} хочет обсудить задачу '${task?.title}':\n'${text}'`,
          discussionOrganizerKeyboard(session.discussTaskId, '0').reply_markup
        )
      }
      session.step = null
      session.discussTaskId = null
      await ctx.reply('Передал организатору.')
      return
    }

    // Редактирование названия задачи (из обсуждения)
    if (session.step === 'edit_task_title' && session.editingTaskId) {
      await supabase.from('tasks').update({ title: text }).eq('id', session.editingTaskId)
      const { data: task } = await supabase.from('tasks').select('assigned_to, title').eq('id', session.editingTaskId).single()
      if (task?.assigned_to) {
        const { data: assignee } = await supabase.from('users').select('telegram_id').eq('id', task.assigned_to).single()
        if (assignee?.telegram_id) {
          await ctx.telegram.sendMessage(
            assignee.telegram_id,
            `Задача обновлена: ${text}`,
            taskActionKeyboard(session.editingTaskId).reply_markup
          )
        }
      }
      session.step = null
      session.editingTaskId = null
      await ctx.reply('Задача обновлена.')
      return
    }

    // Принятие задачи с вводом расписания
    if (session.acceptReminder?.taskId) {
      const taskId = session.acceptReminder.taskId
      const merge = session.acceptReminder.merge
      const user = await getUserWithFamily(ctx)
      if (!user) {
        session.acceptReminder = null
        return next()
      }
      try {
        const { data: existingTask } = await supabase
          .from('tasks')
          .select('reminder_times, frequency, days_of_week, due_date')
          .eq('id', taskId)
          .single()
        const parsed = await parseScheduleFromText(text)
        let reminderTimes = parsed.reminder_times || []
        let frequency = existingTask?.frequency || parsed.frequency || 'once'
        let daysOfWeek = existingTask?.days_of_week || parsed.days_of_week || []
        let dueDate = existingTask?.due_date || parsed.due_date || null

        if (parsed.need_more === 'time' && parsed.frequency === 'once') {
          const onceParsed = await parseOnceFromText(text)
          reminderTimes = onceParsed.reminder_times || []
          if (!merge) dueDate = onceParsed.due_date || null
        } else if (parsed.need_more === 'time' && reminderTimes.length === 0) {
          const { parseReminderTimes } = require('../services/ai')
          reminderTimes = await parseReminderTimes(text, parsed.frequency || 'daily')
        }

        if (merge && existingTask?.reminder_times?.length) {
          reminderTimes = [...(existingTask.reminder_times || []), ...reminderTimes]
        }

        await supabase.from('tasks').update({
          status: 'accepted',
          frequency,
          reminder_times: reminderTimes,
          days_of_week: daysOfWeek,
          due_date: dueDate
        }).eq('id', taskId).eq('assigned_to', user.id)

        const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', taskId).single()
        if (task?.created_by && task.created_by !== user.id) {
          const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
          if (creator) {
            await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} принял(а): ${task?.title}`)
          }
        }

        session.acceptReminder = null
        const timesStr = reminderTimes.length ? ' Буду напоминать по расписанию.' : ''
        await ctx.reply(`Принял.${timesStr}`)
      } catch (e) {
        console.error(e)
        await ctx.reply(merge
          ? 'Не поняла. Попробуй ещё раз.'
          : 'Не поняла расписание. Попробуй ещё раз или нажми «Без напоминаний».')
      }
      return
    }

    // Кнопки reply-клавиатуры
    if (text === 'Добавить задачу') {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      ctx.session.taskFlow = { step: 'full_input' }
      await ctx.reply(ADD_TASK_PROMPT)
      return
    }

    if (text === 'Мои задачи') {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      const today = new Date().toISOString().split('T')[0]
      const dayOfWeek = new Date().getDay()
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, reminder_times, frequency, days_of_week, due_date')
        .eq('assigned_to', user.id)
        .eq('is_active', true)
        .eq('status', 'accepted')
      const relevant = (tasks || []).filter(t => {
        if (t.frequency === 'once') return t.due_date && t.due_date.startsWith(today)
        if (t.frequency === 'weekly' && t.days_of_week?.length) return t.days_of_week.includes(dayOfWeek)
        return true
      })
      if (relevant.length === 0) {
        await ctx.reply('Твои задачи на сегодня:\n\n' + EMPTY_TASKS)
        return
      }
      let msg = 'Твои задачи на сегодня:\n\n'
      const buttons = []
      for (const t of relevant) {
        const timeStr = t.reminder_times?.[0]
          ? `${t.reminder_times[0].hour || 0}:${String(t.reminder_times[0].minute || 0).padStart(2, '0')}`
          : ''
        msg += `${relevant.indexOf(t) + 1}. ${t.title}${timeStr ? ` (${timeStr})` : ''}\n`
        buttons.push([
          { text: `Сделал: ${t.title}`, callback_data: `done_${t.id}` },
          { text: 'Попроси другого', callback_data: `ask_other_${t.id}` }
        ])
      }
      await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons } })
      return
    }

    return next()
  })

  // ─── Inline actions: меню ─────────────────────────────────────────────────

  bot.action('add_task', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        await ctx.answerCbQuery()
        return
      }
      ctx.session = ctx.session || {}
      ctx.session.taskFlow = { step: 'full_input' }
      await ctx.answerCbQuery()
      await ctx.reply(ADD_TASK_PROMPT)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action('my_tasks', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        await ctx.answerCbQuery()
        return
      }
      const today = new Date().toISOString().split('T')[0]
      const dayOfWeek = new Date().getDay()
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, reminder_times, frequency, days_of_week, due_date')
        .eq('assigned_to', user.id)
        .eq('is_active', true)
        .eq('status', 'accepted')
      const relevant = (tasks || []).filter(t => {
        if (t.frequency === 'once') return t.due_date && t.due_date.startsWith(today)
        if (t.frequency === 'weekly' && t.days_of_week?.length) return t.days_of_week.includes(dayOfWeek)
        return true
      })
      if (relevant.length === 0) {
        await ctx.answerCbQuery()
        await ctx.editMessageText(`Твои задачи на сегодня:\n\n${EMPTY_TASKS}`)
        return
      }
      let msg = 'Твои задачи на сегодня:\n\n'
      const buttons = []
      for (const t of relevant) {
        const timeStr = t.reminder_times?.[0]
          ? `${t.reminder_times[0].hour || 0}:${String(t.reminder_times[0].minute || 0).padStart(2, '0')}`
          : ''
        msg += `${relevant.indexOf(t) + 1}. ${t.title}${timeStr ? ` (${timeStr})` : ''}\n`
        buttons.push([
          { text: `Сделал: ${t.title}`, callback_data: `done_${t.id}` },
          { text: 'Попроси другого', callback_data: `ask_other_${t.id}` }
        ])
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText(msg, { reply_markup: { inline_keyboard: buttons } })
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action('week_tasks', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.reply('Задачи на неделю — в разработке. Пока смотри /tasks')
  })

  // ИСПРАВЛЕНО: раньше отправляло текст "/family" вместо вызова функции
  bot.action('family_status', async (ctx) => {
    try {
      const { sendFamilyStatus } = require('./family')
      await ctx.answerCbQuery()
      await sendFamilyStatus(ctx)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery().catch(() => {})
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action('wait_members', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.editMessageText('Когда присоединятся — отправь им ссылку. Можешь добавить задачу когда будешь готов.')
  })

  // ─── Принятие задачи ──────────────────────────────────────────────────────

  bot.action(/^accept_no_reminder_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      await supabase.from('tasks').update({
        status: 'accepted',
        reminder_times: [],
        frequency: 'once'
      }).eq('id', taskId).eq('assigned_to', user.id)
      const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', taskId).single()
      if (task?.created_by && task.created_by !== user.id) {
        const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} принял(а): ${task?.title}`)
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Принял.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^accept_reminder_daily9_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      await supabase.from('tasks').update({
        status: 'accepted',
        frequency: 'daily',
        reminder_times: [{ type: 'daily', hour: 9, minute: 0 }]
      }).eq('id', taskId).eq('assigned_to', user.id)
      const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', taskId).single()
      if (task?.created_by && task.created_by !== user.id) {
        const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} принял(а): ${task?.title}`)
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Принял. Буду напоминать каждый день в 9:00.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^accept_reminder_evening_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      await supabase.from('tasks').update({
        status: 'accepted',
        frequency: 'daily',
        reminder_times: [{ type: 'daily', hour: 19, minute: 0 }]
      }).eq('id', taskId).eq('assigned_to', user.id)
      const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', taskId).single()
      if (task?.created_by && task.created_by !== user.id) {
        const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} принял(а): ${task?.title}`)
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Принял. Буду напоминать вечером в 19:00.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^accept_skip_add_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      await supabase.from('tasks').update({ status: 'accepted' }).eq('id', taskId).eq('assigned_to', user.id)
      const { data: task } = await supabase.from('tasks').select('title, created_by').eq('id', taskId).single()
      if (task?.created_by && task.created_by !== user.id) {
        const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} принял(а): ${task?.title}`)
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Принял.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^accept_add_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      ctx.session = ctx.session || {}
      ctx.session.acceptReminder = { taskId, merge: true }
      await ctx.answerCbQuery()
      await ctx.editMessageText(
        'Напиши свои напоминания, например: «каждый час», «в 18:00», «вечером». Они добавятся к тем, что задал организатор.'
      )
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // Обязательно после всех accept_* с конкретными префиксами
  bot.action(/^accept_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      const { data: task } = await supabase.from('tasks').select('reminder_times, frequency').eq('id', taskId).single()
      const hasOrgReminders = task?.reminder_times?.length > 0
      ctx.session = ctx.session || {}
      await ctx.answerCbQuery()
      if (hasOrgReminders) {
        const timesStr = formatReminderTimes(task.reminder_times)
        await ctx.editMessageText(
          `Организатор задал напоминания: ${timesStr}\n\nХочешь добавить свои?`,
          acceptReminderAddKeyboard(taskId).reply_markup
        )
      } else {
        ctx.session.acceptReminder = { taskId }
        await ctx.editMessageText(
          'Когда напоминать? Напиши как удобно: «каждый час», «в 18:00», «вечером». Или выбери:',
          acceptReminderKeyboard(taskId).reply_markup
        )
      }
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // ─── Отклонение / обсуждение ──────────────────────────────────────────────

  bot.action(/^reject_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      await supabase.from('tasks').update({ status: 'rejected' }).eq('id', taskId).eq('assigned_to', user.id)
      const { data: task } = await supabase.from('tasks').select('created_by').eq('id', taskId).single()
      const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task?.created_by).single()
      if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} отклонил(а) задачу.`)
      await ctx.answerCbQuery()
      await ctx.editMessageText(REJECTED)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^discuss_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      ctx.session = ctx.session || {}
      ctx.session.discussTaskId = taskId
      ctx.session.step = 'discuss_message'
      await ctx.answerCbQuery()
      await ctx.editMessageText('Напиши своё сообщение — я передам организатору')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // ─── Выполнение задачи ────────────────────────────────────────────────────

  bot.action(/^done_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      const { data: task } = await supabase.from('tasks').select('*, users!tasks_assigned_to_fkey(name)').eq('id', taskId).single()
      if (!task || task.assigned_to !== user.id) { await ctx.answerCbQuery(); return }
      const { data: family } = await supabase.from('families').select('timezone').eq('id', task.family_id).single()
      const tz = family?.timezone || 'Europe/Moscow'
      let today
      try {
        today = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date()).replace(/\//g, '-')
      } catch {
        today = new Date().toISOString().split('T')[0]
      }
      await supabase.from('task_completions').insert({
        task_id: taskId,
        completed_by: user.id,
        original_assignee: task.assigned_to,
        family_id: task.family_id,
        date: today
      })
      if (task.created_by && task.created_by !== user.id) {
        const { data: creator } = await supabase.from('users').select('telegram_id').eq('id', task.created_by).single()
        if (creator) await ctx.telegram.sendMessage(creator.telegram_id, `${user.name} сделал(а): ${task.title}`)
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText(getDoneResponse())
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // ─── Снуз — ИСПРАВЛЕНО: теперь реально записывает отсрочку ───────────────

  bot.action(/^snooze_1h_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      // Вставляем запись — wasSentRecently увидит её и не будет слать 50 мин
      await supabase.from('reminders_log').insert({
        task_id: taskId,
        user_id: user.id,
        status: 'snoozed'
      })
      await ctx.answerCbQuery()
      await ctx.editMessageText(SNOOZE_1H)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery().catch(() => {})
    }
  })

  bot.action(/^snooze_evening_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      const tz = user.families?.timezone || 'Europe/Moscow'
      const snoozedUntil = getTimeInTzAsUtc(tz, 19)
      await supabase.from('reminders_log').insert({
        task_id: taskId,
        user_id: user.id,
        status: 'snoozed',
        snoozed_until: snoozedUntil
      })
      await ctx.answerCbQuery()
      await ctx.editMessageText(SNOOZE_EVENING)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery().catch(() => {})
    }
  })

  // ─── «Попросить другого» ──────────────────────────────────────────────────

  bot.action(/^ask_other_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) { await ctx.answerCbQuery(); return }
      const { data: members } = await supabase
        .from('users')
        .select('id, name')
        .eq('family_id', user.family_id)
        .neq('id', user.id)
      if (!members || members.length === 0) {
        await ctx.answerCbQuery()
        await ctx.editMessageText(NO_ONE_TO_ASK)
        return
      }
      ctx.session = ctx.session || {}
      ctx.session.askOther = { taskId, step: 'choose_person' }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Кого попросить?', askOtherKeyboard(members, taskId).reply_markup)
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // Выбор конкретного человека (должен быть после ask_other_*)
  bot.action(/^ask_(.+)_(.+)$/, async (ctx) => {
    try {
      const [, userId, taskId] = ctx.match
      ctx.session = ctx.session || {}
      ctx.session.askOther = ctx.session.askOther || {}
      ctx.session.askOther.targetUserId = userId
      ctx.session.askOther.taskId = taskId
      ctx.session.askOther.step = 'reason'
      await ctx.answerCbQuery()
      await ctx.editMessageText('Почему не можешь сам(а)? Напиши одним предложением 😉')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // ИСПРАВЛЕНО: было `const { data: requester } = await getUserWithFamily(ctx)` → requester был undefined
  bot.action(/^send_ask_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const session = ctx.session?.askOther
      if (!session || session.step !== 'confirm') { await ctx.answerCbQuery(); return }
      const { data: task } = await supabase.from('tasks').select('id, title, assigned_to, family_id').eq('id', taskId).single()
      const { data: target } = await supabase.from('users').select('id, name, request_template, telegram_id').eq('id', session.targetUserId).single()
      const requester = await getUserWithFamily(ctx)
      if (!requester || !target) { await ctx.answerCbQuery(); return }
      const msgText = formatRequestTemplate(target.request_template, requester.name, task.title, session.reason)
      await ctx.telegram.sendMessage(target.telegram_id, msgText, takeTaskKeyboard(taskId).reply_markup)
      ctx.session.askOther = null
      await ctx.telegram.sendMessage(requester.telegram_id, `${target.name} получил просьбу.`)
      await ctx.answerCbQuery()
      await ctx.editMessageText('Отправлено.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // Редактировать текст просьбы — перезапуск reason-шага
  bot.action(/^edit_ask_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      ctx.session = ctx.session || {}
      ctx.session.askOther = ctx.session.askOther || {}
      ctx.session.askOther.taskId = taskId
      ctx.session.askOther.step = 'reason'
      await ctx.answerCbQuery()
      await ctx.editMessageText('Почему не можешь сам(а)? Напиши одним предложением 😉')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  // Отмена просьбы
  bot.action(/^cancel_ask_(.+)$/, async (ctx) => {
    try {
      ctx.session = ctx.session || {}
      ctx.session.askOther = null
      await ctx.answerCbQuery()
      await ctx.editMessageText('Отменено.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  bot.action(/^take_task_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      const { data: task } = await supabase.from('tasks').select('assigned_to, title, family_id').eq('id', taskId).single()
      const prevAssignee = task.assigned_to
      await supabase.from('tasks').update({ assigned_to: user.id }).eq('id', taskId)
      const { data: prevUser } = await supabase.from('users').select('telegram_id').eq('id', prevAssignee).single()
      if (prevUser) await ctx.telegram.sendMessage(prevUser.telegram_id, `${user.name} возьмёт ${task.title}.`)
      await ctx.answerCbQuery()
      await ctx.editMessageText(getDoneResponse())
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^decline_task_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const user = await getUserWithFamily(ctx)
      if (!user) { await ctx.answerCbQuery(); return }
      const { data: task } = await supabase.from('tasks').select('assigned_to').eq('id', taskId).single()
      const requesterId = task?.assigned_to
      const { data: requester } = requesterId
        ? await supabase.from('users').select('telegram_id').eq('id', requesterId).single()
        : { data: null }
      if (requester) {
        await ctx.telegram.sendMessage(
          requester.telegram_id,
          `${user.name} не может. Попросить кого-то ещё?`,
          askOtherRetryKeyboard(taskId).reply_markup
        )
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Записал. Может кто-то ещё выручит?')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^do_myself_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery()
      await ctx.editMessageText('Хорошо! Ты справишься 💪')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery().catch(() => {})
    }
  })

  // ─── Обсуждение — действия организатора ──────────────────────────────────

  bot.action(/^edit_task_disc_(.+)_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      ctx.session = ctx.session || {}
      ctx.session.step = 'edit_task_title'
      ctx.session.editingTaskId = taskId
      await ctx.answerCbQuery()
      await ctx.editMessageText('Напиши новое название задачи:')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  bot.action(/^send_as_is_(.+)_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      const { data: task } = await supabase.from('tasks').select('assigned_to, title').eq('id', taskId).single()
      if (task?.assigned_to) {
        const { data: assignee } = await supabase.from('users').select('telegram_id').eq('id', task.assigned_to).single()
        if (assignee?.telegram_id) {
          await ctx.telegram.sendMessage(
            assignee.telegram_id,
            `Задача остаётся: ${task.title}`,
            taskActionKeyboard(taskId).reply_markup
          )
        }
      }
      await ctx.answerCbQuery()
      await ctx.editMessageText('Задача отправлена как есть.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  bot.action(/^cancel_task_(.+)_(.+)$/, async (ctx) => {
    try {
      const taskId = ctx.match[1]
      await supabase.from('tasks').update({ is_active: false, status: 'done' }).eq('id', taskId)
      await ctx.answerCbQuery()
      await ctx.editMessageText('Задача отменена.')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  // ─── Статистика ───────────────────────────────────────────────────────────

  bot.command('tasks', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      const dayOfWeek = new Date().getDay()
      const today = new Date().toISOString().split('T')[0]
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, reminder_times, frequency, days_of_week, due_date')
        .eq('assigned_to', user.id)
        .eq('is_active', true)
        .eq('status', 'accepted')
      const relevant = (tasks || []).filter(t => {
        if (t.frequency === 'once') return t.due_date && t.due_date.startsWith(today)
        if (t.frequency === 'weekly' && t.days_of_week?.length) return t.days_of_week.includes(dayOfWeek)
        return true
      })
      if (relevant.length === 0) {
        await ctx.reply(`Твои задачи на сегодня:\n\n${EMPTY_TASKS}`)
        return
      }
      let msg = 'Твои задачи на сегодня:\n\n'
      const buttons = []
      for (const t of relevant) {
        const timeStr = t.reminder_times?.[0]
          ? `${t.reminder_times[0].hour || 0}:${String(t.reminder_times[0].minute || 0).padStart(2, '0')}`
          : ''
        msg += `${relevant.indexOf(t) + 1}. ${t.title}${timeStr ? ` (${timeStr})` : ''}\n`
        buttons.push([
          { text: `Сделал: ${t.title}`, callback_data: `done_${t.id}` },
          { text: 'Попроси другого', callback_data: `ask_other_${t.id}` }
        ])
      }
      await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons } })
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.command('stats', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const msg = await buildStatsMessage(user.family_id, user.families, monthStart)
      await ctx.reply(msg, statsKeyboard().reply_markup)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // Кнопка «За этот месяц» — уже показано, просто подтверждаем
  bot.action('stats_month', async (ctx) => {
    await ctx.answerCbQuery('Уже показано за этот месяц')
  })

  // Кнопка «За всё время» — перестраиваем без фильтра по дате
  bot.action('stats_all', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) { await ctx.answerCbQuery(); return }
      const msg = await buildStatsMessage(user.family_id, user.families, null)
      await ctx.answerCbQuery()
      try {
        await ctx.editMessageText(msg, statsKeyboard().reply_markup)
      } catch {
        await ctx.reply(msg, statsKeyboard().reply_markup)
      }
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  // ─── Пейволл ──────────────────────────────────────────────────────────────

  bot.action(/^trial_start_(.+)$/, async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) { await ctx.answerCbQuery(); return }
      const family = user.families
      if (family?.trial_ends_at && new Date(family.trial_ends_at) > new Date()) {
        await ctx.answerCbQuery('Пробный период уже активен')
        return
      }
      await supabase.from('families').update({
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }).eq('id', user.family_id)
      await ctx.answerCbQuery()
      try {
        await ctx.editMessageText('30 дней плана Семья активированы! Добавляй членов семьи, голосовые задачи и остальное ✨')
      } catch {
        await ctx.reply('30 дней плана Семья активированы!')
      }
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
    }
  })

  bot.action(/^paywall_later_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    try { await ctx.editMessageText('Хорошо. Вернёшься когда будешь готов.') } catch {}
  })

  bot.action('pay_family', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.reply('Оплата через бота пока в разработке. Попробуй начать бесплатный период — он действует 30 дней без ограничений.')
  })
}

const { supabase } = require('../db/supabase')
const { confirmTaskKeyboard } = require('../utils/keyboards')
const { formatReminderTimes, formatSchedule, ERROR_MESSAGE, TASK_SENT, ADD_TASK_PROMPT } = require('../utils/messages')
const { parseFullTask } = require('../services/ai')
const { checkTaskLimit } = require('../services/subscription')
const { getUserWithFamily } = require('../utils/db')

module.exports = function (bot) {
  bot.command('add', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }
      ctx.session = ctx.session || {}
      ctx.session.taskFlow = { step: 'full_input' }
      await ctx.reply(ADD_TASK_PROMPT)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.on('text', async (ctx, next) => {
    try {
      const session = ctx.session || {}
      const tf = session.taskFlow
      if (!tf) return next()
      const text = ctx.message.text?.trim()
      if (!text) return next()

      if (tf.step === 'confirm') {
        const t = text.toLowerCase()
        const confirmWords = ['да', 'ок', 'давай', 'отправить', 'окей', 'yes', 'отправь', 'сделай', 'го', 'поехали']
        const editWords = ['нет', 'изменить', 'не то', 'другой']
        if (confirmWords.some(w => t === w || t.startsWith(w + ' ') || t === w + '!' || t === w + '.')) {
          const ok = await doConfirmTask(ctx)
          if (ok) return
        } else if (editWords.some(w => t === w || t.startsWith(w))) {
          tf.step = 'full_input'
          await ctx.reply(ADD_TASK_PROMPT)
          return
        } else {
          await ctx.reply('Нажми «Отправить» или «Изменить» под сообщением выше.')
          return
        }
      }

      if (tf.step === 'full_input') {
        const user = await getUserWithFamily(ctx)
        if (!user || !user.family_id) {
          ctx.session.taskFlow = null
          return next()
        }
        const { data: members } = await supabase.from('users').select('id, name').eq('family_id', user.family_id)
        const memberNames = (members || []).map(m => m.name)
        const parsed = await parseFullTask(text, memberNames)
        const hint = (parsed.assignee_hint || '').toLowerCase()
        const assignee = (members || []).find(m => m.name.toLowerCase().includes(hint) || hint.includes(m.name.toLowerCase()))
        const assigneeId = assignee?.id || (members || [])[0]?.id
        if (!assigneeId) {
          await ctx.reply('Не поняла, кому задача. Напиши имя из семьи: ' + memberNames.join(', '))
          return
        }
        tf.assignedTo = assigneeId
        tf.title = parsed.title
        tf.frequency = parsed.frequency || 'once'
        tf.reminderTimes = parsed.reminder_times || []
        tf.daysOfWeek = parsed.days_of_week || []
        tf.dueDate = parsed.due_date || null
        tf.step = 'confirm'
        await showTaskConfirm(ctx)
        return
      }

      return next()
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^edit_task_draft$/, async (ctx) => {
    ctx.session = ctx.session || {}
    ctx.session.taskFlow = { step: 'full_input' }
    await ctx.answerCbQuery()
    await ctx.reply(ADD_TASK_PROMPT)
  })

  bot.action(/^confirm_task_(.+)$/, async (ctx) => {
    try {
      ctx.session = ctx.session || {}
      const tf = ctx.session.taskFlow
      if (!tf || tf.step !== 'confirm') {
        await ctx.answerCbQuery()
        return
      }
      await doConfirmTask(ctx, true)
      await ctx.answerCbQuery()
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })
}

async function doConfirmTask(ctx, fromButton = false) {
  const tf = ctx.session?.taskFlow
  if (!tf || tf.step !== 'confirm') return false
  const user = await getUserWithFamily(ctx)
  if (!user || !user.family_id) {
    await ctx.reply('Сессия истекла. Напиши /add заново.')
    return false
  }
  const taskCheck = await checkTaskLimit(user.family_id)
  if (!taskCheck.ok && taskCheck.paywall === 'tasks') {
    if (fromButton) {
      await ctx.editMessageText(
        'Достигнут лимит задач на бесплатном плане.',
        require('../utils/keyboards').paywallTasksKeyboard().reply_markup
      )
    } else {
      await ctx.reply('Достигнут лимит задач на бесплатном плане.', require('../utils/keyboards').paywallTasksKeyboard().reply_markup)
    }
    return false
  }
  const { data: assignee } = await supabase.from('users').select('id, name, telegram_id').eq('id', tf.assignedTo).single()
  if (!assignee) {
    await ctx.reply(ERROR_MESSAGE)
    return false
  }
  const { data: task, error } = await supabase.from('tasks').insert({
    title: tf.title,
    assigned_to: tf.assignedTo,
    created_by: user.id,
    family_id: user.family_id,
    frequency: tf.frequency || 'once',
    reminder_times: tf.reminderTimes || [],
    days_of_week: tf.daysOfWeek || [],
    due_date: tf.dueDate || null,
    status: 'pending'
  }).select().single()
  if (error) {
    await ctx.reply(ERROR_MESSAGE)
    return false
  }
  ctx.session.taskFlow = null
  const { data: creator } = await supabase.from('users').select('name').eq('id', user.id).single()
  const msg = `Пинок от ${creator?.name || 'организатора'}:\n\n${task.title}\n\nЧто скажешь?`
  const kb = require('../utils/keyboards').taskActionKeyboard(task.id)
  await ctx.telegram.sendMessage(assignee.telegram_id, msg, kb.reply_markup)
  if (fromButton) {
    await ctx.editMessageText(TASK_SENT(assignee?.name || ''))
  } else {
    await ctx.reply(TASK_SENT(assignee?.name || ''))
  }
  return true
}

async function showTaskConfirm(ctx) {
  const tf = ctx.session.taskFlow
  const { data: assignee } = await supabase.from('users').select('name').eq('id', tf.assignedTo).single()
  const sched = formatSchedule(tf)
  const times = formatReminderTimes(tf.reminderTimes || [])
  const msg = `Задача для ${assignee?.name || '?'}:\n${tf.title}\n${sched}\nНапоминания: ${times}\n\nПолучатель сможет добавить свои напоминания при принятии.\n\nОтправить? (или напиши «да»)`
  await ctx.reply(msg, confirmTaskKeyboard('draft').reply_markup)
  tf.confirmTaskId = 'draft'
}


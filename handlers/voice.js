const fs = require('fs')
const path = require('path')
const OpenAI = require('openai')
const { supabase } = require('../db/supabase')
const { parseFullTask } = require('../services/ai')
const { confirmTaskKeyboard } = require('../utils/keyboards')
const { formatReminderTimes, formatSchedule } = require('../utils/messages')
const { checkVoiceLimit, incrementVoiceUsed } = require('../services/subscription')
const { ERROR_MESSAGE } = require('../utils/messages')
const { getUserWithFamily } = require('../utils/db')

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

module.exports = function (bot) {
  bot.on('voice', async (ctx) => {
    try {
      const user = await getUserWithFamily(ctx)
      if (!user || !user.family_id) {
        await ctx.reply('Сначала создай или присоединись к семье.')
        return
      }

      const voiceCheck = await checkVoiceLimit(user.family_id)
      if (!voiceCheck.ok && voiceCheck.paywall === 'voice') {
        await ctx.reply(
          'Пробные голосовые закончились.\nВ плане Семья — без ограничений.',
          require('../utils/keyboards').paywallVoiceKeyboard().reply_markup
        )
        return
      }

      const file = await ctx.telegram.getFile(ctx.message.voice.file_id)
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
      const response = await fetch(url)
      const buffer = Buffer.from(await response.arrayBuffer())
      const tmpPath = path.join(process.cwd(), `voice_${Date.now()}.ogg`)
      fs.writeFileSync(tmpPath, buffer)

      let transcribedText = ''
      if (openai) {
        try {
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tmpPath),
            model: 'whisper-1',
            language: 'ru'
          })
          transcribedText = transcription.text || ''
        } catch (e) {
          console.error('Transcription error:', e)
        }
      }
      fs.unlinkSync(tmpPath)

      if (!transcribedText) {
        await ctx.reply('Не удалось распознать голос. Попробуй ещё раз или добавь задачу текстом через /add')
        return
      }

      const { data: members } = await supabase.from('users').select('id, name').eq('family_id', user.family_id)
      const memberNames = (members || []).map(m => m.name)
      const parsed = await parseFullTask(transcribedText, memberNames)
      const hint = (parsed.assignee_hint || '').toLowerCase()
      const assignee = (members || []).find(m => m.name.toLowerCase().includes(hint) || hint.includes(m.name.toLowerCase()))
      const assigneeId = assignee?.id || (members || [])[0]?.id
      if (!assigneeId) {
        await ctx.reply('Не расслышала, кому задача. Напиши: ' + memberNames.join(', '))
        return
      }
      ctx.session = ctx.session || {}
      ctx.session.taskFlow = {
        step: 'confirm',
        assignedTo: assigneeId,
        title: parsed.title,
        frequency: parsed.frequency || 'once',
        reminderTimes: parsed.reminder_times || [],
        daysOfWeek: parsed.days_of_week || [],
        dueDate: parsed.due_date || null,
        confirmTaskId: 'draft'
      }

      await incrementVoiceUsed(user.family_id)

      const sched = formatSchedule(ctx.session.taskFlow)
      const times = formatReminderTimes(parsed.reminder_times || [])
      const msg = 'Расслышала:\n\nЗадача для ' + (assignee?.name || '?') + ':\n' + parsed.title + '\n' + sched + '\nНапоминания: ' + times + '\n\nОтправить?'
      await ctx.reply(msg, confirmTaskKeyboard('draft').reply_markup)
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })

}

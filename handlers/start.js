const { supabase } = require('../db/supabase')
const { skipTemplateKeyboard, afterCreateFamilyKeyboard, timezoneKeyboard, TZ_BUTTONS } = require('../utils/keyboards')
const { ERROR_MESSAGE } = require('../utils/messages')
const { checkMemberLimit } = require('../services/subscription')
const crypto = require('crypto')

function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase()
}

function parseTimezone(text) {
  const t = (text || '').toLowerCase().trim()
  const map = {
    'london': 'Europe/London', 'лондон': 'Europe/London',
    'berlin': 'Europe/Berlin', 'берлин': 'Europe/Berlin', 'paris': 'Europe/Paris', 'париж': 'Europe/Paris',
    'moscow': 'Europe/Moscow', 'москва': 'Europe/Moscow', 'мск': 'Europe/Moscow',
    'dubai': 'Asia/Dubai', 'дубай': 'Asia/Dubai',
    'tokyo': 'Asia/Tokyo', 'токио': 'Asia/Tokyo',
    'sydney': 'Australia/Sydney', 'сидней': 'Australia/Sydney',
    'new york': 'America/New_York', 'нью-йорк': 'America/New_York', 'ny': 'America/New_York',
    'los angeles': 'America/Los_Angeles', 'лос-анджелес': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
    'europe/london': 'Europe/London', 'europe/berlin': 'Europe/Berlin', 'europe/moscow': 'Europe/Moscow',
    'asia/dubai': 'Asia/Dubai', 'asia/tokyo': 'Asia/Tokyo', 'australia/sydney': 'Australia/Sydney',
    'america/new_york': 'America/New_York', 'america/los_angeles': 'America/Los_Angeles',
    'utc': 'UTC', 'utc+0': 'UTC', 'utc+1': 'Europe/Berlin', 'utc+2': 'Europe/Kiev',
    'utc+3': 'Europe/Moscow', 'utc+4': 'Asia/Dubai', 'utc+5': 'Asia/Yekaterinburg',
    'utc+8': 'Asia/Shanghai', 'utc+9': 'Asia/Tokyo', 'utc+10': 'Australia/Sydney',
    'utc-5': 'America/New_York', 'utc-8': 'America/Los_Angeles'
  }
  for (const [k, v] of Object.entries(map)) {
    if (t === k || t.includes(k)) return v
  }
  if (/^[a-z]+\/[a-z_]+$/i.test(t)) return t
  return null
}

async function createFamilyAndContinue(ctx, timezone = 'Europe/Moscow') {
  const { familyName, creatorName } = ctx.session
  if (!supabase || !familyName || !creatorName) {
    await ctx.reply(ERROR_MESSAGE)
    return
  }
  const inviteCode = generateInviteCode()
  const { data: family, error: famErr } = await supabase.from('families').insert({
    name: familyName,
    invite_code: inviteCode,
    plan: 'free',
    timezone: timezone || 'Europe/Moscow',
    trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }).select().single()
  if (famErr) throw famErr
  const { data: user, error: userErr } = await supabase.from('users').insert({
    telegram_id: ctx.from.id,
    telegram_username: ctx.from.username,
    name: creatorName,
    role: 'manager',
    family_id: family.id
  }).select().single()
  if (userErr) throw userErr
  ctx.session.step = 'request_template'
  ctx.session.user = user
  ctx.session.family = family
  const botInfo = await ctx.telegram.getMe()
  const inviteLink = `https://t.me/${botInfo.username}?start=join_${inviteCode}`
  await ctx.reply('Семья создана. Отправь ссылку остальным:\n' + inviteLink, afterCreateFamilyKeyboard().reply_markup)
  await ctx.reply(
    'У тебя 30 дней плана Семья бесплатно.\n\nДоступно:\n— до 6 членов семьи\n— безлимитные задачи\n— голосовые задачи\n— вечерний дайджест\n\nПосле триала — 2.49€/мес или 19.90€/год.'
  )
  await ctx.reply(
    'Последний шаг. Как тебя нужно просить о помощи?\n\nНапиши шаблон — его увидят только когда захотят попросить тебя взять чужую задачу.\n\nНапример:\n«о моя богиня, пожалуйста сжалься и [задача] — [причина]»\n«бабуль, выручишь? [задача]. Буду должен»\n\nВместо [задача] и [причина] подставится реальный текст.\nМожно пропустить — тогда будет стандартная вежливая просьба.',
    skipTemplateKeyboard().reply_markup
  )
}

async function joinFamilyAndContinue(ctx) {
  const { joinFamily, joinName } = ctx.session
  if (!supabase || !joinFamily || !joinName) {
    await ctx.reply(ERROR_MESSAGE)
    return
  }
  const memberCheck = await checkMemberLimit(joinFamily.id)
  if (!memberCheck.ok && memberCheck.paywall === 'members') {
    await ctx.reply(
      'Для семей от 3 человек нужен план Семья.\nПервые 30 дней бесплатно — попробуй прямо сейчас.',
      require('../utils/keyboards').paywallKeyboard('members').reply_markup
    )
    return
  }
  const { data: user, error: userErr } = await supabase.from('users').insert({
    telegram_id: ctx.from.id,
    telegram_username: ctx.from.username,
    name: joinName,
    role: 'member',
    family_id: joinFamily.id
  }).select().single()
  if (userErr) throw userErr
  const { data: members } = await supabase.from('users').select('telegram_id').eq('family_id', joinFamily.id).neq('id', user.id)
  for (const m of members || []) {
    try { await ctx.telegram.sendMessage(m.telegram_id, `К семье присоединился(ась) ${joinName}`) } catch (_) {}
  }
  ctx.session.step = 'request_template'
  ctx.session.user = user
  ctx.session.family = joinFamily
  await ctx.reply(
    'Последний шаг. Как тебя нужно просить о помощи?\n\nНапиши шаблон — его увидят только когда захотят попросить тебя взять чужую задачу.\n\nНапример:\n«о моя богиня, пожалуйста сжалься и [задача] — [причина]»\n«бабуль, выручишь? [задача]. Буду должен»\n\nВместо [задача] и [причина] подставится реальный текст.\nМожно пропустить — тогда будет стандартная вежливая просьба.',
    skipTemplateKeyboard().reply_markup
  )
}

module.exports = function (bot) {
  bot.start(async (ctx, next) => {
    try {
      const args = ctx.message?.text?.split(' ') || []
      const deepLink = args[1]

      if (deepLink && deepLink.startsWith('join_')) {
        const code = deepLink.replace('join_', '').toUpperCase()
        ctx.session = ctx.session || {}
        const { data: family } = supabase
          ? await supabase.from('families').select('*').eq('invite_code', code).single()
          : { data: null }
        if (family) {
          ctx.session.joinFamily = family
          ctx.session.step = 'join_family_name'
          await ctx.reply('Как вас зовут?')
        } else {
          ctx.session.step = 'join_code'
          ctx.session.joinCode = code
          await ctx.reply('Код приглашения не найден. Введи код вручную.')
        }
        return
      }

      const { data: user } = supabase
        ? await supabase.from('users').select('*, families(*)').eq('telegram_id', ctx.from.id).single()
        : { data: null }

      if (user && user.family_id) {
        ctx.session = ctx.session || {}
        ctx.session.user = user
        ctx.session.family = user.families
        await ctx.reply(
          'С возвращением!\n\nМеню внизу — добавь задачу, посмотри семью.',
          {
            reply_markup: {
              keyboard: [['Добавить задачу'], ['Мои задачи', 'Семья']],
              resize_keyboard: true,
              is_persistent: true
            }
          }
        )
        return
      }

      ctx.session = ctx.session || {}
      ctx.session.step = 'welcome'
      await ctx.reply(
        'Привет! Я Пинок — распределяю задачи по дому. Вечером покажу, кто что сделал.\n\n' +
        'Как тестировать: нажми «Создать семью» → придумай название → введи своё имя. Потом добавь задачу себе.',
        {
          reply_markup: {
            keyboard: [['Создать семью'], ['Присоединиться к семье']],
            resize_keyboard: true,
            is_persistent: true
          }
        }
      )
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
    return next()
  })

  bot.action('create_family', async (ctx) => {
    try {
      ctx.session = ctx.session || {}
      ctx.session.step = 'create_family_name'
      await ctx.answerCbQuery()
      await ctx.editMessageText('Как назовём вашу семью? (например: Семья Ивановых)')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action(/^tz_(.+)$/, async (ctx) => {
    try {
      const match = ctx.match[1]
      if (match === 'other') {
        ctx.session.step = 'create_family_timezone'
        await ctx.answerCbQuery()
        await ctx.editMessageText('Напиши часовой пояс, например: Europe/London, America/New_York или название города')
        return
      }
      const tz = TZ_BUTTONS[match] || match.replace(/_/g, '/')
      await createFamilyAndContinue(ctx, tz)
      await ctx.answerCbQuery()
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery().catch(() => {})
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action('join_family', async (ctx) => {
    try {
      ctx.session = ctx.session || {}
      ctx.session.step = 'join_code'
      ctx.session.joinCode = null
      await ctx.answerCbQuery()
      await ctx.editMessageText('Введи код приглашения или перейди по ссылке')
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.action('skip_template', async (ctx) => {
    try {
      ctx.session = ctx.session || {}
      const { user } = ctx.session
      if (user && supabase) {
        await supabase.from('users').update({ request_template: null }).eq('id', user.id)
      }
      ctx.session = {}
      await ctx.answerCbQuery()
      await ctx.editMessageText('Записал.')
      await ctx.reply('Чем помочь?', { reply_markup: require('../utils/keyboards').mainMenuKeyboard().reply_markup })
    } catch (e) {
      console.error(e)
      await ctx.answerCbQuery()
      await ctx.reply(ERROR_MESSAGE)
    }
  })

  bot.on('text', async (ctx, next) => {
    try {
      const session = ctx.session || {}
      const step = session.step
      const text = ctx.message.text?.trim()

      if (text === 'Создать семью' && (step === 'welcome' || !step)) {
        ctx.session.step = 'create_family_name'
        await ctx.reply('Как назовём вашу семью? (например: Семья Ивановых)')
        return
      }
      if (text === 'Присоединиться к семье' && (step === 'welcome' || !step)) {
        ctx.session.step = 'join_code'
        ctx.session.joinCode = null
        await ctx.reply('Введи код приглашения или перейди по ссылке')
        return
      }

      if (step === 'create_family_name') {
        ctx.session.familyName = text
        ctx.session.step = 'create_family_creator_name'
        await ctx.reply('Как вас зовут?')
        return
      }

      if (step === 'create_family_creator_name') {
        ctx.session.creatorName = text
        ctx.session.step = 'create_family_timezone'
        await ctx.reply('В каком часовом поясе вы? Напоминания придут в вашем местном времени.', timezoneKeyboard().reply_markup)
        return
      }

      if (step === 'create_family_timezone') {
        const tz = parseTimezone(text)
        if (tz) {
          await createFamilyAndContinue(ctx, tz)
          return
        }
        await ctx.reply('Нажми кнопку или напиши, например: London, Europe/Moscow, America/New_York')
        return
      }

      if (step === 'join_code') {
        const code = (text || session.joinCode || '').toUpperCase().replace(/\s/g, '')
        if (!code || code.length < 4) {
          await ctx.reply('Код слишком короткий. Введи код из 6 символов.')
          return
        }
        const { data: family } = supabase
          ? await supabase.from('families').select('*').eq('invite_code', code).single()
          : { data: null }
        if (!family) {
          await ctx.reply('Семья с таким кодом не найдена. Проверь код.')
          return
        }
        ctx.session.joinFamily = family
        ctx.session.step = 'join_family_name'
        await ctx.reply('Как вас зовут?')
        return
      }

      if (step === 'join_family_name') {
        ctx.session.joinName = text
        await joinFamilyAndContinue(ctx)
        return
      }

      if (step === 'request_template') {
        const { user } = ctx.session
        if (user && supabase) {
          await supabase.from('users').update({ request_template: text || null }).eq('id', user.id)
        }
        ctx.session = {}
        await ctx.reply('Записал. Меню внизу — добавь задачу, посмотри семью.', {
          reply_markup: {
            keyboard: [['Добавить задачу'], ['Мои задачи', 'Семья']],
            resize_keyboard: true,
            is_persistent: true
          }
        })
        return
      }

      return next()
    } catch (e) {
      console.error(e)
      await ctx.reply(ERROR_MESSAGE)
    }
  })
}

const { Telegraf } = require('telegraf')
const express = require('express')
const path = require('path')
const crypto = require('crypto')
require('dotenv').config()

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()

const { supabaseSession } = require('./utils/session')
bot.use(supabaseSession())

const startHandler = require('./handlers/start')
const familyHandler = require('./handlers/family')
const tasksHandler = require('./handlers/tasks')
const callbacksHandler = require('./handlers/callbacks')
const voiceHandler = require('./handlers/voice')
const { startScheduler } = require('./services/scheduler')
const { startDigest } = require('./services/digest')
const { supabase } = require('./db/supabase')
const { replyMenuMain } = require('./utils/keyboards')

startHandler(bot)
familyHandler(bot)
callbacksHandler(bot)
tasksHandler(bot)
voiceHandler(bot)

startScheduler(bot)
startDigest(bot)

bot.command('cancel', async (ctx) => {
  try {
    ctx.session = {}
    const { data: user } = supabase
      ? await supabase.from('users').select('family_id').eq('telegram_id', ctx.from.id).single()
      : { data: null }
    if (user?.family_id) {
      await ctx.reply('Отменено.', replyMenuMain().reply_markup)
    } else {
      await ctx.reply('Отменено.', {
        reply_markup: {
          keyboard: [['Создать семью'], ['Присоединиться к семье']],
          resize_keyboard: true,
          is_persistent: true
        }
      })
    }
  } catch {
    ctx.session = {}
    await ctx.reply('Отменено.')
  }
})

// ══════════════════════════════════════════════
//  WEB SERVER + MINI APP API
// ══════════════════════════════════════════════

app.use(express.json())
app.use(express.static(path.join(__dirname, 'webapp')))

// ── Telegram initData validation ──
function validateInitData(initDataStr, token) {
  if (!initDataStr) return null
  try {
    const params = new URLSearchParams(initDataStr)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
    const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    if (hash !== expected) return null
    const userStr = params.get('user')
    if (!userStr) return null
    return JSON.parse(userStr)
  } catch { return null }
}

// ── Auth middleware ──
async function authenticate(req, res, next) {
  if (!supabase) return res.status(503).json({ ok: false, error: 'DB not configured' })
  const initData = req.headers['x-init-data'] || ''
  const tgUser = validateInitData(initData, process.env.BOT_TOKEN)
  const isDev = process.env.NODE_ENV !== 'production'
  if (!tgUser && !isDev) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  const telegramId = tgUser?.id || (isDev && parseInt(req.headers['x-dev-id'])) || null
  if (!telegramId) return res.status(401).json({ ok: false, error: 'No user ID' })
  const { data: user } = await supabase
    .from('users')
    .select('id, name, role, family_id')
    .eq('telegram_id', telegramId)
    .single()
  if (!user) return res.status(404).json({ ok: false, error: 'User not found. Start the bot first.' })
  req.dbUser = user
  next()
}

// ── POST /api/auth ──
app.post('/api/auth', async (req, res) => {
  if (!supabase) return res.json({ ok: false, error: 'DB not configured' })
  const { initData } = req.body
  const tgUser = validateInitData(initData, process.env.BOT_TOKEN)
  const isDev = process.env.NODE_ENV !== 'production'
  if (!tgUser && !isDev) return res.json({ ok: false, error: 'Invalid auth' })
  const telegramId = tgUser?.id || (isDev && parseInt(req.body.devId)) || null
  if (!telegramId) return res.json({ ok: false, error: 'No user ID' })

  const { data: user } = await supabase
    .from('users').select('id, name, role, family_id').eq('telegram_id', telegramId).single()
  if (!user) return res.json({ ok: false, error: 'Not registered' })

  const { data: family } = await supabase
    .from('families').select('id, name, invite_code, plan, timezone, digest_hour').eq('id', user.family_id).single()

  const { data: members } = await supabase
    .from('users').select('id, name, role').eq('family_id', user.family_id)

  res.json({ ok: true, user: { ...user, family, members: members || [] } })
})

// ── GET /api/tasks/today ──
app.get('/api/tasks/today', authenticate, async (req, res) => {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', req.dbUser.id)
    .eq('is_active', true)
    .neq('status', 'rejected')
    .order('created_at', { ascending: false })

  // Mark recurring tasks as done if completed today
  const today = new Date().toISOString().split('T')[0]
  const { data: todayDone } = await supabase
    .from('task_completions')
    .select('task_id')
    .eq('completed_by', req.dbUser.id)
    .eq('date', today)
  const doneToday = new Set((todayDone || []).map(c => c.task_id))
  const result = (tasks || []).map(t => doneToday.has(t.id) ? { ...t, status: 'done' } : t)

  res.json({ ok: true, tasks: result })
})

// ── POST /api/tasks/:id/complete ──
app.post('/api/tasks/:id/complete', authenticate, async (req, res) => {
  const user = req.dbUser
  const { data: task } = await supabase
    .from('tasks').select('*').eq('id', req.params.id).eq('assigned_to', user.id).single()
  if (!task) return res.json({ ok: false, error: 'Task not found' })

  await supabase.from('task_completions').insert({
    task_id: task.id, completed_by: user.id,
    original_assignee: user.id, family_id: user.family_id
  })
  if (task.frequency && task.frequency !== 'once') {
    // Recurring: keep active, reset status so it shows again next cycle
    await supabase.from('tasks').update({ status: 'accepted' }).eq('id', task.id)
  } else {
    await supabase.from('tasks').update({ status: 'done', is_active: false }).eq('id', task.id)
  }
  res.json({ ok: true })
})

// ── POST /api/tasks/parse ──
app.post('/api/tasks/parse', authenticate, async (req, res) => {
  const { text } = req.body
  if (!text) return res.json({ ok: false, error: 'No text' })
  const { parseFullTask } = require('./services/ai')
  const { data: members } = await supabase
    .from('users').select('id, name').eq('family_id', req.dbUser.family_id)
  const memberNames = (members || []).map(m => m.name)
  try {
    const parsed = await parseFullTask(text, memberNames)
    // Resolve assignee hint → actual user ID
    if (parsed.assignee_hint && members?.length) {
      const hint = parsed.assignee_hint.toLowerCase()
      const match = members.find(m => m.name.toLowerCase().includes(hint) || hint.includes(m.name.toLowerCase()))
      if (match) parsed.assigneeId = match.id
    }
    if (!parsed.assigneeId) parsed.assigneeId = req.dbUser.id
    // Human-readable display
    const whoMember = members?.find(m => m.id === parsed.assigneeId)
    parsed.assignee = whoMember?.name || 'Мне'
    res.json({ ok: true, parsed })
  } catch (e) {
    console.error('parse error', e)
    res.json({ ok: false, error: 'Parse failed' })
  }
})

// ── POST /api/tasks/create ──
app.post('/api/tasks/create', authenticate, async (req, res) => {
  const user = req.dbUser
  const p = req.body
  const assigneeId = p.assigneeId || user.id
  const { data: task, error } = await supabase.from('tasks').insert({
    title: p.title, assigned_to: assigneeId, created_by: user.id,
    family_id: user.family_id, frequency: p.frequency || 'once',
    reminder_times: p.reminder_times || [], days_of_week: p.days_of_week || [],
    due_date: p.due_date || null, is_recurring: (p.frequency || 'once') !== 'once',
    status: 'pending', is_active: true
  }).select().single()

  if (error) return res.json({ ok: false, error: error.message })

  // Notify assignee if different person
  if (assigneeId !== user.id) {
    const { data: assignee } = await supabase.from('users').select('telegram_id').eq('id', assigneeId).single()
    if (assignee?.telegram_id) {
      bot.telegram.sendMessage(assignee.telegram_id,
        `🥊 *${user.name}* дал тебе пинок:\n*${p.title}*`, { parse_mode: 'Markdown' }
      ).catch(() => {})
    }
  }
  res.json({ ok: true, task })
})

// ── GET /api/stats ──
app.get('/api/stats', authenticate, async (req, res) => {
  const user = req.dbUser
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const { data: weekCompletions } = await supabase
    .from('task_completions').select('completed_at')
    .eq('completed_by', user.id).gte('completed_at', weekAgo.toISOString())

  const weekData = [0, 0, 0, 0, 0, 0, 0]
  for (const c of weekCompletions || []) {
    const d = new Date(c.completed_at)
    weekData[(d.getDay() + 6) % 7]++
  }

  const { count: totalDone } = await supabase
    .from('task_completions').select('id', { count: 'exact', head: true }).eq('completed_by', user.id)

  // Streak: consecutive days (backwards from today) with at least 1 completion
  const { data: allDates } = await supabase
    .from('task_completions').select('date').eq('completed_by', user.id)
    .order('date', { ascending: false }).limit(60)
  let streak = 0
  if (allDates?.length) {
    const uniqueDates = [...new Set(allDates.map(c => c.date))].sort().reverse()
    const today = new Date().toISOString().split('T')[0]
    let check = new Date(); check.setDate(check.getDate() - 1)
    for (const d of uniqueDates) {
      const checkStr = check.toISOString().split('T')[0]
      if (d === checkStr || d === today) {
        streak++; check.setDate(check.getDate() - 1)
      } else break
    }
  }

  res.json({ ok: true, weekData, streak, totalDone: totalDone || 0 })
})

// ══════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════
const PORT = process.env.PORT || 3000

if (process.env.WEBHOOK_URL) {
  // Production: webhook mode (required for Render free tier)
  // Note: bot.webhookCallback must be mounted on root app, not sub-path
  // because Telegraf internally checks req.path against webhookPath
  const webhookPath = '/webhook'
  app.use(bot.webhookCallback(webhookPath))
  bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}${webhookPath}`)
    .then(() => console.log('Webhook set:', process.env.WEBHOOK_URL + webhookPath))
    .catch(e => console.error('Webhook set error:', e))
  app.listen(PORT, () => console.log(`Пинок запущен на порту ${PORT} (webhook mode)`))
} else {
  // Local: polling mode
  app.listen(PORT, () => console.log(`Web server on http://localhost:${PORT}`))
  bot.launch()
  console.log('Пинок запущен (polling mode)')
}

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

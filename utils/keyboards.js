const { Markup } = require('telegraf')

// Reply-клавиатура (меню внизу экрана)
const replyMenuNew = () =>
  Markup.keyboard([['Создать семью'], ['Присоединиться к семье']])
    .resize()
    .persistent()

const replyMenuMain = () =>
  Markup.keyboard([['Добавить задачу'], ['Мои задачи', 'Семья']])
    .resize()
    .persistent()

const mainMenuKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Добавить задачу', 'add_task')],
  [Markup.button.callback('Мои задачи', 'my_tasks'),
   Markup.button.callback('Семья', 'family_status')],
  [Markup.button.callback('На неделю', 'week_tasks')]
])

const startKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Создать семью', 'create_family')],
  [Markup.button.callback('Присоединиться к семье', 'join_family')]
])

const TZ_BUTTONS = {
  london: 'Europe/London',
  berlin: 'Europe/Berlin',
  moscow: 'Europe/Moscow',
  dubai: 'Asia/Dubai',
  tokyo: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  ny: 'America/New_York',
  la: 'America/Los_Angeles'
}

const timezoneKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Лондон', 'tz_london'), Markup.button.callback('Берлин', 'tz_berlin')],
  [Markup.button.callback('Москва', 'tz_moscow'), Markup.button.callback('Дубай', 'tz_dubai')],
  [Markup.button.callback('Токио', 'tz_tokyo'), Markup.button.callback('Сидней', 'tz_sydney')],
  [Markup.button.callback('Нью-Йорк', 'tz_ny'), Markup.button.callback('Лос-Анджелес', 'tz_la')],
  [Markup.button.callback('Другой (напишу)', 'tz_other')]
])

const skipTemplateKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Пропустить', 'skip_template')]
])

const afterCreateFamilyKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Добавить задачу', 'add_task')],
  [Markup.button.callback('Жду остальных', 'wait_members')]
])

const frequencyKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Каждый день', 'freq_daily')],
  [Markup.button.callback('Через день', 'freq_every_2_days')],
  [Markup.button.callback('Раз в неделю', 'freq_weekly')],
  [Markup.button.callback('Свой интервал', 'freq_custom')],
  [Markup.button.callback('Один раз', 'freq_once')]
])

const daysOfWeekKeyboard = (selected = []) => {
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const buttons = days.map((d, i) => {
    const idx = i + 1
    const label = selected.includes(idx) ? `[${d}]` : d
    return Markup.button.callback(label, `day_${idx}`)
  })
  return Markup.inlineKeyboard([
    buttons.slice(0, 4),
    buttons.slice(4, 7),
    [Markup.button.callback('Готово', 'days_done')]
  ])
}

const confirmTaskKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Отправить', `confirm_task_${taskId}`)],
  [Markup.button.callback('Изменить', `edit_task_${taskId}`)]
])

const taskActionKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Принял', `accept_${taskId}`),
   Markup.button.callback('Обсудить', `discuss_${taskId}`),
   Markup.button.callback('Отклонить', `reject_${taskId}`)]
])

const acceptReminderKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Без напоминаний', `accept_no_reminder_${taskId}`)],
  [Markup.button.callback('Каждый день в 9:00', `accept_reminder_daily9_${taskId}`), Markup.button.callback('Вечером (19:00)', `accept_reminder_evening_${taskId}`)]
])

const acceptReminderAddKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Добавить свои', `accept_add_${taskId}`)],
  [Markup.button.callback('Нет, достаточно', `accept_skip_add_${taskId}`)]
])

const reminderKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Сделал', `done_${taskId}`)],
  [Markup.button.callback('Напомни через 1ч', `snooze_1h_${taskId}`),
   Markup.button.callback('Напомни вечером', `snooze_evening_${taskId}`)],
  [Markup.button.callback('Попроси другого', `ask_other_${taskId}`)]
])

const taskListKeyboard = (tasks) => {
  const buttons = tasks.map(t => [
    Markup.button.callback(`Сделал: ${t.title}`, `done_${t.id}`),
    Markup.button.callback('Попроси другого', `ask_other_${t.id}`)
  ])
  return Markup.inlineKeyboard(buttons)
}

const askOtherKeyboard = (members, taskId) => {
  const buttons = members.map(m => [Markup.button.callback(m.name, `ask_${m.id}_${taskId}`)])
  return Markup.inlineKeyboard(buttons)
}

const confirmAskKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Отправить', `send_ask_${taskId}`)],
  [Markup.button.callback('Изменить текст', `edit_ask_${taskId}`)],
  [Markup.button.callback('Отмена', `cancel_ask_${taskId}`)]
])

const takeTaskKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Возьму', `take_task_${taskId}`)],
  [Markup.button.callback('Не могу', `decline_task_${taskId}`)]
])

const askOtherRetryKeyboard = (taskId) => Markup.inlineKeyboard([
  [Markup.button.callback('Попросить другого', `ask_other_${taskId}`)],
  [Markup.button.callback('Сделаю сам', `do_myself_${taskId}`)]
])

const discussionOrganizerKeyboard = (taskId, discussionId) => Markup.inlineKeyboard([
  [Markup.button.callback('Изменить задачу', `edit_task_disc_${taskId}_${discussionId}`)],
  [Markup.button.callback('Отправить как есть', `send_as_is_${taskId}_${discussionId}`)],
  [Markup.button.callback('Отменить задачу', `cancel_task_${taskId}_${discussionId}`)]
])

const statsKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('За этот месяц', 'stats_month')],
  [Markup.button.callback('За всё время', 'stats_all')]
])

const paywallKeyboard = (action) => Markup.inlineKeyboard([
  [Markup.button.callback('Начать 30 дней бесплатно', `trial_start_${action}`)],
  [Markup.button.callback('Позже', `paywall_later_${action}`)]
])

const paywallVoiceKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Оформить Семья — 2.49€/мес', 'pay_family')],
  [Markup.button.callback('Позже', 'paywall_later_voice')]
])

const paywallTasksKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Оформить Семья — 2.49€/мес', 'pay_family')],
  [Markup.button.callback('Позже', 'paywall_later_tasks')]
])

const voiceConfirmKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('Верно, отправить', 'voice_confirm')],
  [Markup.button.callback('Изменить', 'voice_edit')],
  [Markup.button.callback('Отмена', 'voice_cancel')]
])

module.exports = {
  replyMenuNew,
  replyMenuMain,
  mainMenuKeyboard,
  startKeyboard,
  timezoneKeyboard,
  TZ_BUTTONS,
  skipTemplateKeyboard,
  afterCreateFamilyKeyboard,
  frequencyKeyboard,
  daysOfWeekKeyboard,
  confirmTaskKeyboard,
  taskActionKeyboard,
  acceptReminderKeyboard,
  acceptReminderAddKeyboard,
  reminderKeyboard,
  taskListKeyboard,
  askOtherKeyboard,
  confirmAskKeyboard,
  takeTaskKeyboard,
  askOtherRetryKeyboard,
  discussionOrganizerKeyboard,
  statsKeyboard,
  paywallKeyboard,
  paywallVoiceKeyboard,
  paywallTasksKeyboard,
  voiceConfirmKeyboard
}

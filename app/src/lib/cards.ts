// Карточки «Это тоже ты?» — копия server/cards.js, менять оба.
export type InvisibleCard = { key: string; emoji: string; title: string; per_week: number }

export const INVISIBLE_CARDS: InvisibleCard[] = [
  {
    key: 'birthdays',
    emoji: '🎂',
    title: 'Помнить про дни рождения и покупать подарки',
    per_week: 0.5
  },
  {
    key: 'doctors',
    emoji: '💉',
    title: 'Следить за врачами и прививками',
    per_week: 0.5
  },
  {
    key: 'running_out',
    emoji: '🧻',
    title: 'Замечать, что кончается еда и бытовое',
    per_week: 5
  },
  {
    key: 'shopping_list',
    emoji: '🛒',
    title: 'Составлять список покупок',
    per_week: 2
  },
  {
    key: 'menu',
    emoji: '🍲',
    title: 'Решать, что готовить',
    per_week: 7
  },
  {
    key: 'kids_clothes',
    emoji: '👕',
    title: 'Знать, что ребёнок вырос из одежды',
    per_week: 0.25
  },
  {
    key: 'school_docs',
    emoji: '📝',
    title: 'Документы, оплаты и чаты школы/садика',
    per_week: 2
  },
  {
    key: 'kids_schedule',
    emoji: '🗓',
    title: 'Помнить расписание кружков и секций',
    per_week: 3
  },
  {
    key: 'bills',
    emoji: '💸',
    title: 'Помнить про счета и платежи',
    per_week: 0.5
  },
  {
    key: 'where_things',
    emoji: '🔎',
    title: 'Знать, где что лежит, и отвечать «где…?»',
    per_week: 7
  },
  {
    key: 'reminding',
    emoji: '📣',
    title: 'Напоминать другим про их дела',
    per_week: 7
  },
  {
    key: 'gifts_family',
    emoji: '🎁',
    title: 'Подарки учителям, родне, на праздники',
    per_week: 0.25
  },
  {
    key: 'household_repairs',
    emoji: '🔧',
    title: 'Замечать, что сломалось, и вызывать мастера',
    per_week: 0.25
  },
  {
    key: 'weekend_plans',
    emoji: '🎈',
    title: 'Планировать выходные и досуг семьи',
    per_week: 1
  },
  {
    key: 'pets',
    emoji: '🐾',
    title: 'Ветеринар, корм, прививки питомца',
    per_week: 0.5
  }
]

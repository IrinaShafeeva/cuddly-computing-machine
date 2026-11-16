// Уровни пинков и фразы (docs/PRODUCT.md §4)
export const kickLevels = {
  1: { name: 'Лёгкий пинок', emoji: '🥊' },
  2: { name: 'Пинок с разбега', emoji: '🥊💨' },
  3: { name: 'Пинок с вертушки', emoji: '🌀🥊' },
  4: { name: 'КОСМИЧЕСКИЙ ПИНОК', emoji: '⚡🥊⚡' },
} as const

const phrases: Record<1 | 2 | 3 | 4, string[]> = {
  1: ['Эй, тут дело есть 👀', 'Напоминаю по-дружески', 'Тук-тук, это дело'],
  2: ['Оно само себя не сделает', 'Ну давай, давай!', 'Дело скучает без тебя'],
  3: ['Это уже серьёзно', 'Вся семья смотрит на тебя', 'Дом начинает нервничать'],
  4: ['ХЬЮСТОН, У НАС ПРОБЛЕМА', 'Ты в открытом космосе без дела', 'Последнее предупреждение с орбиты'],
}

export function randomPhrase(level: 1 | 2 | 3 | 4): string {
  const list = phrases[level]
  return list[Math.floor(Math.random() * list.length)]
}

export const kickResponses = [
  { key: 'on_my_way', label: 'Уже бегу!' },
  { key: 'in_10', label: 'Через 10 минут' },
  { key: 'leave_me', label: 'Отстань 😤' },
] as const

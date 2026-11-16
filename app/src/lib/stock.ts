// Запасы: зоны дома и готовые наборы (docs/PRODUCT.md §10)
export type Zone = 'fridge' | 'pantry' | 'bathroom' | 'chemicals' | 'kids' | 'other'
export type Level = 'plenty' | 'low' | 'out'

export type StockItem = {
  id: string
  name: string
  icon: string | null
  zone: Zone
  level: Level | null
  on_shopping_list: boolean
  last_checked_at: string | null
  last_checked_by: string | null
}

export const ZONES: { key: Zone; icon: string; label: string }[] = [
  { key: 'fridge', icon: '🧊', label: 'Холодильник' },
  { key: 'pantry', icon: '🥫', label: 'Кладовка' },
  { key: 'bathroom', icon: '🛁', label: 'Ванная' },
  { key: 'chemicals', icon: '🧴', label: 'Химия' },
  { key: 'kids', icon: '👶', label: 'Детское' },
  { key: 'other', icon: '📦', label: 'Разное' },
]

export const LEVELS: { key: Level; label: string; color: 'green' | 'yellow' | 'red' }[] = [
  { key: 'plenty', label: 'Много', color: 'green' },
  { key: 'low', label: 'Мало', color: 'yellow' },
  { key: 'out', label: 'Нет', color: 'red' },
]

type Pack = { name: string; icon: string }

// Готовые наборы для пустого дома
export const PACKS: Record<Zone, Pack[]> = {
  fridge: [
    { name: 'Молоко', icon: '🥛' }, { name: 'Яйца', icon: '🥚' }, { name: 'Сыр', icon: '🧀' },
    { name: 'Масло', icon: '🧈' }, { name: 'Помидоры', icon: '🍅' }, { name: 'Огурцы', icon: '🥒' },
    { name: 'Йогурт', icon: '🥣' }, { name: 'Колбаса', icon: '🥓' }, { name: 'Фрукты', icon: '🍎' },
    { name: 'Зелень', icon: '🌿' },
  ],
  pantry: [
    { name: 'Хлеб', icon: '🍞' }, { name: 'Макароны', icon: '🍝' }, { name: 'Рис', icon: '🍚' },
    { name: 'Гречка', icon: '🌾' }, { name: 'Кофе', icon: '☕' }, { name: 'Чай', icon: '🫖' },
    { name: 'Сахар', icon: '🍬' }, { name: 'Мука', icon: '🥡' }, { name: 'Масло растительное', icon: '🫒' },
    { name: 'Печенье', icon: '🍪' },
  ],
  bathroom: [
    { name: 'Туалетная бумага', icon: '🧻' }, { name: 'Зубная паста', icon: '🪥' }, { name: 'Шампунь', icon: '🧴' },
    { name: 'Мыло', icon: '🧼' }, { name: 'Гель для душа', icon: '🚿' },
  ],
  chemicals: [
    { name: 'Порошок', icon: '🫧' }, { name: 'Средство для посуды', icon: '🍽' }, { name: 'Таблетки для посудомойки', icon: '💊' },
    { name: 'Мусорные пакеты', icon: '🗑' }, { name: 'Губки', icon: '🧽' }, { name: 'Бумажные полотенца', icon: '🧻' },
  ],
  kids: [
    { name: 'Подгузники', icon: '👶' }, { name: 'Влажные салфетки', icon: '🧻' }, { name: 'Детское питание', icon: '🍼' },
    { name: 'Сок', icon: '🧃' },
  ],
  other: [],
}

export const STOCK_ICONS = ['🍅', '🥛', '🥚', '🧀', '🍞', '🍎', '🍌', '🥔', '🧅', '🥕', '🍗', '🐟', '☕', '🧻', '🧴', '🧼', '🫧', '🍼', '🐾', '📦']

// Ретро-аркада из webapp/index.html + цвета огня (docs/PRODUCT.md §12)
export const colors = {
  bg: '#0a0a0a',
  card: '#161616',
  card2: '#1e1e1e',
  border: '#262626',
  green: '#39ff14',
  greenDark: '#0a2200',
  greenMid: 'rgba(57,255,20,0.18)',
  yellow: '#ffd60a',
  red: '#ff3b30',
  fire: '#ff6a00',
  gold: '#ffc83d',
  text: '#e8e8e8',
  dim: '#777',
  dimmer: '#444',
}

export const fonts = {
  pixel: 'PressStart2P_400Regular',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyBold: 'Inter_700Bold',
}

export type Heat = 'green' | 'yellow' | 'red' | 'fire'

export const heatColor: Record<Heat, string> = {
  green: colors.green,
  yellow: colors.yellow,
  red: colors.red,
  fire: colors.fire,
}

// Цвета людей в семье — по порядку вступления
export const memberColors = ['#39ff14', '#4cc9f0', '#f72585', '#ffd60a', '#b5179e', '#ff8fab', '#90e0ef']

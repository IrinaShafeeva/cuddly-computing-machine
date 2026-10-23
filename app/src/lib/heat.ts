import type { Heat } from './theme'
import type { Appliance, Flag, Occurrence } from './types'

const H = 3600_000

// Дело: 🟢 до срока · 🟡 срок в ближайшие 3 часа · 🔴 просрочено · 🔥 просрочено > 3 часов
export function occurrenceHeat(o: Occurrence, now = Date.now()): Heat {
  if (o.status === 'missed') return 'fire'
  const left = new Date(o.due_at).getTime() - now
  if (left > 3 * H) return 'green'
  if (left > 0) return 'yellow'
  if (left > -3 * H) return 'red'
  return 'fire'
}

// Флаг: просьба со сроком — как дело; заметка — горит тем сильнее, чем дольше висит
export function flagHeat(f: Flag, now = Date.now()): Heat {
  if (f.due_at) {
    const left = new Date(f.due_at).getTime() - now
    if (left > 12 * H) return 'green'
    if (left > 3 * H) return 'yellow'
    if (left > 0) return 'red'
    return 'fire'
  }
  const age = now - new Date(f.created_at).getTime()
  if (age < 0.5 * H) return 'yellow'
  if (age < 3 * H) return 'red'
  return 'fire'
}

// Прибор: цвет статуса; красный дольше часа — 🔥
export function applianceHeat(a: Appliance, now = Date.now()): Heat {
  const st = a.states.find((s) => s.key === a.state)
  const base = st?.heat ?? 'green'
  if (base === 'red' && now - new Date(a.state_changed_at).getTime() > H) return 'fire'
  return base
}

export const heatRank: Record<Heat, number> = { fire: 0, red: 1, yellow: 2, green: 3 }

export function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч ${m % 60} мин`
  return `${Math.floor(h / 24)} дн`
}

export function dueLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const diff = d.getTime() - now
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  if (diff < 0) return `просрочено на ${ago(iso, now)}`
  const sameDay = new Date(now).toDateString() === d.toDateString()
  if (sameDay) return `сегодня до ${time}`
  const tomorrow = new Date(now + 86400_000).toDateString() === d.toDateString()
  if (tomorrow) return `завтра до ${time}`
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ` до ${time}`
}

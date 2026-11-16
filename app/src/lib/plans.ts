import type { KickPlan } from './types'

// Готовые варианты «как пинать» (docs/PRODUCT.md §3.2)
export const kickPresets = [
  { key: 'once', label: 'Один раз', hint: 'за час до срока' },
  { key: 'morning', label: 'Утром', hint: 'в 8:00' },
  { key: 'three', label: 'Утро · обед · вечер', hint: '8:00, 13:00, 19:00' },
  { key: 'escalate', label: 'Нарастает к сроку', hint: 'раз в день → за 3 дня 2 раза → в последний день каждый час' },
  { key: 'hourly', label: 'Каждый час до победного', hint: 'с 8 до 22' },
  { key: 'custom', label: 'Своё время', hint: 'например 7:30, 12:00, 20:00' },
] as const

export type KickPresetKey = (typeof kickPresets)[number]['key']

export function hourBefore(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const t = (h * 60 + m - 60 + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function parseTimes(text: string): string[] {
  return [...text.matchAll(/(\d{1,2})[:.](\d{2})/g)]
    .map(([, h, m]) => `${h.padStart(2, '0')}:${m}`)
    .filter((t) => Number(t.slice(0, 2)) < 24 && Number(t.slice(3)) < 60)
    .sort()
}

export function buildKickPlan(preset: KickPresetKey, dueTime: string, customTimes: string, wakeUp: boolean): KickPlan {
  const base = { overdue: 'keep_kicking' as const, wake_up: wakeUp, escalation: [] as KickPlan['escalation'] }
  switch (preset) {
    case 'once': return { ...base, base: { type: 'before', minutes: 60 } }
    case 'morning': return { ...base, base: { type: 'times', times: ['08:00'] } }
    case 'three': return { ...base, base: { type: 'times', times: ['08:00', '13:00', '19:00'] } }
    case 'escalate': return {
      ...base,
      base: { type: 'times', times: ['10:00'] },
      escalation: [
        { before: 'P3D', type: 'times', times: ['10:00', '19:00'] },
        { before: 'P1D', type: 'every', minutes: 60, between: ['09:00', '21:00'] },
      ],
    }
    case 'hourly': return { ...base, base: { type: 'every', minutes: 60, between: ['08:00', '22:00'] } }
    case 'custom': {
      const times = parseTimes(customTimes)
      return { ...base, base: { type: 'times', times: times.length ? times : [hourBefore(dueTime)] } }
    }
  }
}

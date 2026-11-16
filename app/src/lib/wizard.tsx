import { createContext, useContext, useState, type ReactNode } from 'react'

// Состояние онбординга между шагами
export type DiagItem = {
  id: string
  title: string
  who: string | null          // profile id; null = непонятно / «нет такого»
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'rarely'
  per_week: number
  invisible: boolean
  emoji: string | null
  source: 'voice' | 'card' | 'manual'
  existing?: boolean          // из прошлой диагностики (режим «Дополнить»)
}

type Wizard = {
  items: DiagItem[]
  setItems: (f: (prev: DiagItem[]) => DiagItem[]) => void
  transcript: string
  setTranscript: (t: string) => void
  stock: string[]
  setStock: (s: string[]) => void
  covered: string[]
  setCovered: (c: string[]) => void
  savedCount: number            // сколько дел было в сохранённом снимке (0 — ещё не сохраняли)
  setSavedCount: (n: number) => void
  invites: { profile_id: string; name: string; token: string }[]
  addInvite: (i: { profile_id: string; name: string; token: string }) => void
}

const Ctx = createContext<Wizard | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [items, setItemsState] = useState<DiagItem[]>([])
  const [transcript, setTranscript] = useState('')
  const [stock, setStock] = useState<string[]>([])
  const [covered, setCovered] = useState<string[]>([])
  const [invites, setInvites] = useState<Wizard['invites']>([])
  const [savedCount, setSavedCount] = useState(0)
  return (
    <Ctx.Provider value={{
      items, setItems: (f) => setItemsState(f), transcript, setTranscript,
      stock, setStock, covered, setCovered, savedCount, setSavedCount,
      invites, addInvite: (i) => setInvites((prev) => [...prev, i]),
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useWizard() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWizard outside WizardProvider')
  return c
}

export const uid = () => Math.random().toString(36).slice(2, 10)

// Доли нагрузки — так же, как diagnosis_stats в базе
export function shares(items: DiagItem[]) {
  const by: Record<string, { total: number; invisible: number }> = {}
  let all = 0
  for (const i of items) {
    if (!i.who) continue
    by[i.who] ??= { total: 0, invisible: 0 }
    by[i.who].total += i.per_week
    if (i.invisible) by[i.who].invisible += i.per_week
    all += i.per_week
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) =>
    [k, { ...v, share: all ? v.total / all : 0 }]))
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim()

// Добавить новые дела к списку без повторов (по названию)
export function mergeItems(prev: DiagItem[], incoming: DiagItem[]) {
  const seen = new Set(prev.map((i) => norm(i.title)))
  return [...prev, ...incoming.filter((i) => !seen.has(norm(i.title)) && seen.add(norm(i.title)))]
}

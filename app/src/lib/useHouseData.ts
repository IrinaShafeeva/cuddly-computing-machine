import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { supabase } from './supabase'
import { useSession } from './session'
import type { Activity, Appliance, Flag, Occurrence, Task } from './types'

export type HouseData = {
  occurrences: Occurrence[]   // открытые/пропущенные + сделанные сегодня
  flags: Flag[]               // открытые и взятые
  appliances: Appliance[]
  stars: Record<string, number>
  weekStars: Record<string, number>
  activity: Activity[]
  drafts: Task[]             // мои черновики дел (после голосового разбора)
  reviews: Occurrence[]      // «сделано» — ждут моей проверки
}

const empty: HouseData = { occurrences: [], flags: [], appliances: [], stars: {}, weekStars: {}, activity: [], drafts: [], reviews: [] }

// Все данные дома + realtime-обновления + «тик» раз в 30 с, чтобы огонь разгорался сам
export function useHouseData() {
  const { household, session } = useSession()
  const me = session?.user.id
  const [data, setData] = useState<HouseData>(empty)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hookId = useId()   // у каждого экрана свой realtime-канал

  const load = useCallback(async () => {
    if (!household) return
    const hh = household.id
    await supabase.rpc('ensure_today', { p_household: hh })
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const weekAgo = new Date(Date.now() - 7 * 86400_000)
    const [open, doneToday, flags, appliances, ledger, activity, drafts, reviews] = await Promise.all([
      supabase.from('task_occurrences').select('*, task:tasks(*)').eq('household_id', hh)
        .in('status', ['open', 'missed']).order('due_at'),
      supabase.from('task_occurrences').select('*, task:tasks(*)').eq('household_id', hh)
        .eq('status', 'done').gte('done_at', startOfDay.toISOString()).order('done_at', { ascending: false }),
      supabase.from('flags').select('*').eq('household_id', hh).in('status', ['open', 'claimed'])
        .order('created_at', { ascending: false }),
      supabase.from('appliances').select('*').eq('household_id', hh).order('created_at'),
      supabase.from('star_ledger').select('user_id, amount, created_at').eq('household_id', hh),
      supabase.from('activity').select('*').eq('household_id', hh)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('tasks').select('*').eq('household_id', hh).eq('status', 'draft').eq('created_by', me ?? '')
        .order('created_at'),
      supabase.from('task_occurrences').select('*, task:tasks!inner(*)').eq('household_id', hh)
        .eq('status', 'done').eq('review', 'pending').eq('task.created_by', me ?? '').order('done_at'),
    ])
    const stars: Record<string, number> = {}
    const weekStars: Record<string, number> = {}
    for (const r of ledger.data ?? []) {
      stars[r.user_id] = (stars[r.user_id] ?? 0) + r.amount
      if (new Date(r.created_at) >= weekAgo) weekStars[r.user_id] = (weekStars[r.user_id] ?? 0) + r.amount
    }
    setData({
      occurrences: [...(open.data ?? []), ...(doneToday.data ?? [])] as Occurrence[],
      flags: (flags.data ?? []) as Flag[],
      appliances: (appliances.data ?? []) as Appliance[],
      stars, weekStars,
      activity: (activity.data ?? []) as Activity[],
      drafts: (drafts.data ?? []) as Task[],
      reviews: ((reviews.data ?? []) as Occurrence[]).filter((o) => o.done_by !== me),
    })
    setLoading(false)
  }, [household, me])

  const reloadSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(load, 300)
  }, [load])

  useFocusEffect(useCallback(() => { load() }, [load]))

  useEffect(() => {
    if (!household) return
    const filter = `household_id=eq.${household.id}`
    const ch = supabase.channel(`house:${household.id}:${hookId}`)
    for (const table of ['task_occurrences', 'flags', 'appliances', 'activity']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, reloadSoon)
    }
    ch.subscribe()
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => { supabase.removeChannel(ch); clearInterval(tick) }
  }, [household, reloadSoon, hookId])

  return { ...data, loading, now, reload: load }
}

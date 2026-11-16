import { useCallback, useEffect, useId, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { supabase } from './supabase'
import { useSession } from './session'
import type { Guide, GuidePhoto } from './types'

export type GuideFull = Guide & { item?: GuidePhoto; place_photo?: GuidePhoto; history: GuidePhoto[] }

// Гиды дома + последние фото (вещь и место) + история фото
export function useGuides() {
  const { household } = useSession()
  const [guides, setGuides] = useState<GuideFull[]>([])
  const [loading, setLoading] = useState(true)
  const chId = useId()

  const load = useCallback(async () => {
    if (!household) return
    const [g, p] = await Promise.all([
      supabase.from('guides').select('*').eq('household_id', household.id).order('updated_at', { ascending: false }),
      supabase.from('guide_photos').select('*').eq('household_id', household.id).order('created_at', { ascending: false }),
    ])
    const photos = (p.data ?? []) as GuidePhoto[]
    setGuides(((g.data ?? []) as Guide[]).map((x) => {
      const mine = photos.filter((ph) => ph.guide_id === x.id)
      return { ...x, steps: x.steps ?? [], item: mine.find((ph) => ph.kind === 'item'),
        place_photo: mine.find((ph) => ph.kind === 'place'), history: mine }
    }))
    setLoading(false)
  }, [household])

  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => {
    if (!household) return
    const filter = `household_id=eq.${household.id}`
    const ch = supabase.channel(`guides:${household.id}:${chId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guides', filter }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guide_photos', filter }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [household, load, chId])

  return { guides, loading, reload: load }
}

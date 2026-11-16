import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useGuides } from '@/lib/useGuides'
import { askPhoto } from '@/lib/photos'
import { ago } from '@/lib/heat'
import { colors } from '@/lib/theme'
import type { Task } from '@/lib/types'
import { Photo } from '@/components/Photo'
import { Body, Button, Pixel, SectionTitle } from '@/components/ui'

// Один гид: фото вещи, где лежит, шаги, история фото, связанные дела
export default function GuideView() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { household, member } = useSession()
  const { guides, reload } = useGuides()
  const navigation = useNavigation()
  const g = guides.find((x) => x.id === id)
  const [tasks, setTasks] = useState<Task[]>([])
  const [busy, setBusy] = useState<'item' | 'place' | null>(null)

  useEffect(() => { if (g) navigation.setOptions({ title: g.title }) }, [g?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.from('tasks').select('*').eq('guide_id', id).eq('status', 'active')
      .then(({ data }) => setTasks((data ?? []) as Task[]))
  }, [id])

  if (!g) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  const update = async (kind: 'item' | 'place') => {
    const path = await askPhoto(household!.id, 'guide', kind === 'item' ? 'Как выглядит сейчас' : 'Где лежит / где стоит')
    if (!path) return
    setBusy(kind)
    const { error } = await supabase.rpc('add_guide_photo', { p_guide: g.id, p_kind: kind, p_path: path })
    setBusy(null)
    if (error) return Alert.alert('Не получилось', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    reload()
  }
  const who = (uid: string | null | undefined, at: string) => `${member(uid)?.display_name ?? ''} · ${ago(at)}`

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pixel size={14} color={colors.green} glow>{g.icon ? `${g.icon} ` : ''}{g.title.toUpperCase()}</Pixel>

      <SectionTitle>КАК ВЫГЛЯДИТ СЕЙЧАС</SectionTitle>
      {g.item ? <>
        <Photo path={g.item.path} style={s.big} />
        <Body size={12} color={colors.dim} style={{ marginTop: 6 }}>📸 обновил(а) {who(g.item.by_user, g.item.created_at)}</Body>
      </> : <Body color={colors.dim}>Фото ещё нет</Body>}
      <Button title="📸 ОБНОВИТЬ ФОТО" onPress={() => update('item')} loading={busy === 'item'} style={{ marginTop: 10 }} />

      <SectionTitle>ГДЕ ЛЕЖИТ · СТАВЬ НА МЕСТО</SectionTitle>
      {g.place ? <Body size={16} style={{ marginBottom: 10 }}>📍 {g.place}</Body> : null}
      {g.place_photo ? <>
        <Photo path={g.place_photo.path} style={s.big} />
        <Body size={12} color={colors.dim} style={{ marginTop: 6 }}>📸 {who(g.place_photo.by_user, g.place_photo.created_at)}</Body>
      </> : null}
      <Button variant="ghost" small title={g.place_photo ? '📸 МЕСТО ПОМЕНЯЛОСЬ' : '📸 СФОТКАТЬ МЕСТО'}
        onPress={() => update('place')} loading={busy === 'place'} style={{ marginTop: 10 }} />

      {g.steps.length > 0 && <>
        <SectionTitle>КАК</SectionTitle>
        {g.steps.map((st, i) => (
          <View key={i} style={s.step}>
            <Pixel size={10} color={colors.green}>{i + 1}</Pixel>
            <Body style={{ flex: 1 }}>{st.text}</Body>
          </View>
        ))}
      </>}

      {tasks.length > 0 && <>
        <SectionTitle>ДЕЛА С ЭТИМ ГИДОМ</SectionTitle>
        {tasks.map((t) => (
          <Body key={t.id} style={{ marginBottom: 6 }}>{t.icon ?? '✅'} {t.title} · {member(t.assignee_id)?.display_name ?? ''}</Body>
        ))}
      </>}

      {g.history.length > 1 && <>
        <SectionTitle>ИСТОРИЯ ФОТО</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {g.history.map((p) => (
            <View key={p.id} style={{ marginRight: 8, width: 100 }}>
              <Photo path={p.path} style={{ width: 100, height: 100 }} />
              <Body size={10} color={colors.dimmer} style={{ marginTop: 4 }}>
                {p.kind === 'place' ? '📍 ' : ''}{who(p.by_user, p.created_at)}
              </Body>
            </View>
          ))}
        </ScrollView>
      </>}

      <Button variant="ghost" title="✎ ПОПРАВИТЬ ТЕКСТ" onPress={() => router.push({ pathname: '/new-guide', params: { id: g.id } })}
        style={{ marginTop: 28 }} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  big: { width: '100%', height: 260 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
})

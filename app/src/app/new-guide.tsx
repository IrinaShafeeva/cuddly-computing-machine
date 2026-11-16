import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { askPhoto } from '@/lib/photos'
import { colors } from '@/lib/theme'
import type { Guide } from '@/lib/types'
import { Photo } from '@/components/Photo'
import { Body, Button, Input, SectionTitle } from '@/components/ui'

const ICONS = ['🧽', '🧺', '🍽', '🗑', '🧴', '🧹', '🔧', '🪴', '🐕', '👶', '🔌', '📦']

// Новый гид или правка текста: /new-guide?id=<guide>
export default function NewGuide() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { household } = useSession()
  const navigation = useNavigation()
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [place, setPlace] = useState('')
  const [steps, setSteps] = useState<string[]>([''])
  const [item, setItem] = useState<string | null>(null)
  const [placePhoto, setPlacePhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    navigation.setOptions({ title: id ? 'Гид' : 'Новый гид' })
    if (!id) return
    supabase.from('guides').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      const g = data as Guide | null
      if (!g) return
      setTitle(g.title); setIcon(g.icon); setPlace(g.place ?? '')
      setSteps(g.steps?.length ? g.steps.map((x) => x.text) : [''])
    })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!title.trim()) return Alert.alert('Как называется?', 'Например: Губка для стола')
    setBusy(true)
    const { data, error } = await supabase.rpc('save_guide', {
      p_household: household!.id, p_id: id ?? null, p_title: title.trim(), p_icon: icon, p_place: place.trim(),
      p_steps: steps.map((t) => t.trim()).filter(Boolean).map((text) => ({ text })),
    })
    if (error) { setBusy(false); return Alert.alert('Ошибка', error.message) }
    const gid = (data as Guide).id
    if (item) await supabase.rpc('add_guide_photo', { p_guide: gid, p_kind: 'item', p_path: item })
    if (placePhoto) await supabase.rpc('add_guide_photo', { p_guide: gid, p_kind: 'place', p_path: placePhoto })
    setBusy(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (id) router.back()
    else router.replace({ pathname: '/guide/[id]', params: { id: gid } })
  }

  const remove = () => Alert.alert('Удалить гид?', title, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Удалить', style: 'destructive', onPress: async () => {
      const { error } = await supabase.rpc('delete_guide', { p_guide: id })
      if (error) return Alert.alert('Ошибка', error.message)
      router.dismissTo('/guide')
    } },
  ])

  const photoRow = (label: string, path: string | null, set: (p: string | null) => void, folderTitle: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      {path ? <Photo path={path} style={{ width: 80, height: 80 }} /> : null}
      <Button small variant="ghost" title={path ? 'ДРУГОЕ ФОТО' : label} style={{ flex: 1 }}
        onPress={async () => { const p = await askPhoto(household!.id, 'guide', folderTitle); if (p) set(p) }} />
    </View>
  )

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled">
      <SectionTitle>ЧТО</SectionTitle>
      <Input value={title} onChangeText={setTitle} placeholder="Губка для стола" autoFocus={!id} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {ICONS.map((e) => (
          <Pressable key={e} onPress={() => setIcon(icon === e ? null : e)}
            style={{ padding: 6, borderWidth: 1, borderColor: icon === e ? colors.green : 'transparent' }}>
            <Body size={22}>{e}</Body>
          </Pressable>
        ))}
      </View>

      <SectionTitle>ГДЕ ЛЕЖИТ</SectionTitle>
      <Input value={place} onChangeText={setPlace} placeholder="На раковине, справа, в мыльнице" />
      {!id && photoRow('📸 ФОТО МЕСТА', placePhoto, setPlacePhoto, 'Где лежит')}

      {!id && <>
        <SectionTitle>КАК ВЫГЛЯДИТ</SectionTitle>
        {photoRow('📸 ФОТО ВЕЩИ', item, setItem, 'Как выглядит сейчас')}
      </>}

      <SectionTitle>ШАГИ (НЕОБЯЗАТЕЛЬНО)</SectionTitle>
      {steps.map((t, i) => (
        <Input key={i} value={t} placeholder={i === 0 ? 'Меняем раз в неделю, новые — в шкафу под раковиной' : `Шаг ${i + 1}`}
          onChangeText={(v) => setSteps(steps.map((x, k) => (k === i ? v : x)))} multiline />
      ))}
      <Button small variant="ghost" title="+ ЕЩЁ ШАГ" onPress={() => setSteps([...steps, ''])} />

      <Button title={id ? 'СОХРАНИТЬ' : 'СОЗДАТЬ ГИД'} onPress={save} loading={busy} style={{ marginTop: 28 }} />
      {id && <Button variant="danger" title="УДАЛИТЬ ГИД" onPress={remove} style={{ marginTop: 12 }} />}
    </ScrollView>
  )
}

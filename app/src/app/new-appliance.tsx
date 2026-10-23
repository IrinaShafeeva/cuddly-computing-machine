import { useState } from 'react'
import { Alert, Pressable, ScrollView } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Body, Button, Input, SectionTitle } from '@/components/ui'

const KINDS = [
  { kind: 'washer', name: 'Стиралка', icon: '🧺', cycle: 'свободна → стирается → разобрать → сушится → сложить' },
  { kind: 'dishwasher', name: 'Посудомойка', icon: '🍽', cycle: 'загружается → моет → разгрузить' },
  { kind: 'dryer', name: 'Сушилка', icon: '🌀', cycle: 'свободна → сушит → достать и сложить' },
  { kind: 'custom', name: 'Другое', icon: '🔧', cycle: 'всё хорошо ↔ нужно внимание' },
] as const

export default function NewAppliance() {
  const { household } = useSession()
  const [pick, setPick] = useState<(typeof KINDS)[number]>(KINDS[0])
  const [name, setName] = useState<string>(KINDS[0].name)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('create_appliance', {
      p_household: household!.id, p_name: name.trim() || pick.name, p_kind: pick.kind, p_icon: pick.icon,
    })
    setBusy(false)
    if (error) return Alert.alert('Ошибка', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <SectionTitle>ЧТО ЗА ПРИБОР</SectionTitle>
      {KINDS.map((k) => (
        <Pressable key={k.kind} onPress={() => { Haptics.selectionAsync(); setPick(k); setName(k.name) }}
          style={{ borderWidth: 1, borderColor: pick.kind === k.kind ? colors.green : colors.border,
            backgroundColor: pick.kind === k.kind ? colors.greenMid : colors.card, padding: 12, marginBottom: 6 }}>
          <Body weight="medium">{k.icon}  {k.name}</Body>
          <Body size={12} color={colors.dim} style={{ marginTop: 3 }}>{k.cycle}</Body>
        </Pressable>
      ))}
      <SectionTitle>НАЗВАНИЕ</SectionTitle>
      <Input value={name} onChangeText={setName} />
      <Button title="ДОБАВИТЬ" onPress={save} loading={busy} style={{ marginTop: 16 }} />
    </ScrollView>
  )
}

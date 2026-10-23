import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Body, Button, Chip, Input, SectionTitle } from '@/components/ui'

const QUICK = ['Закончилась туалетная бумага', 'Стирка готова — кто разберёт?', 'Нужно погладить',
  'Посуда в раковине', 'Мусор полный', 'Кончился хлеб']

const DEADLINES = [
  { label: 'Без срока', hours: null },
  { label: 'Через 2 часа', hours: 2 },
  { label: 'К вечеру', hours: 'evening' },
  { label: 'К завтра 8:00', hours: 'tomorrow' },
] as const

export default function NewFlag() {
  const { household } = useSession()
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState<(typeof DEADLINES)[number]['hours']>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!title.trim()) return Alert.alert('Что случилось?')
    let due: Date | null = null
    if (deadline === 'evening') { due = new Date(); due.setHours(20, 0, 0, 0) }
    else if (deadline === 'tomorrow') { due = new Date(); due.setDate(due.getDate() + 1); due.setHours(8, 0, 0, 0) }
    else if (typeof deadline === 'number') due = new Date(Date.now() + deadline * 3600_000)

    setBusy(true)
    const { error } = await supabase.rpc('raise_flag', {
      p_household: household!.id, p_title: title.trim(),
      p_kind: due ? 'request' : 'notice', p_due_at: due?.toISOString() ?? null,
    })
    setBusy(false)
    if (error) return Alert.alert('Ошибка', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Body color={colors.dim} style={{ marginTop: 8 }}>
        Флаг видят все. Кто первый нажмёт «Беру!», тот и делает. Тебе — звёзды за внимательность.
      </Body>
      <SectionTitle>ЧТО СЛУЧИЛОСЬ</SectionTitle>
      <Input value={title} onChangeText={setTitle} placeholder="Чёрная стирка — рабочая одежда" autoFocus multiline />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {QUICK.map((q) => <Chip key={q} label={q} active={title === q} onPress={() => setTitle(q)} />)}
      </View>
      <SectionTitle>СРОК</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DEADLINES.map((d) => (
          <Chip key={d.label} label={d.label} color={colors.yellow} active={deadline === d.hours} onPress={() => setDeadline(d.hours)} />
        ))}
      </View>
      <Button title="КИНУТЬ ФЛАГ 🚩" onPress={save} loading={busy} style={{ marginTop: 28 }} />
    </ScrollView>
  )
}

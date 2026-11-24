import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Body, Button } from '@/components/ui'

// Приборы со статусами создаются сразу; остальное — запоминаем для следующих этапов
const THINGS = [
  { key: 'washer', icon: '🧺', label: 'Стиралка', appliance: 'Стиралка' },
  { key: 'dryer', icon: '🌀', label: 'Сушилка', appliance: 'Сушилка' },
  { key: 'dishwasher', icon: '🍽', label: 'Посудомойка', appliance: 'Посудомойка' },
  { key: 'vacuum', icon: '🤖', label: 'Робот-пылесос', appliance: null },
  { key: 'kids', icon: '👶', label: 'Дети', appliance: null },
  { key: 'pets', icon: '🐾', label: 'Питомцы', appliance: null },
  { key: 'car', icon: '🚗', label: 'Машина', appliance: null },
  { key: 'garden', icon: '🌳', label: 'Сад / двор', appliance: null },
] as const

// Шаг 3: что есть дома
export default function HomeStuff() {
  const { household } = useSession()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = (k: string) => {
    Haptics.selectionAsync()
    setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k])
  }

  const next = async () => {
    setBusy(true)
    // прибор такого вида уже есть (вернулась на шаг назад) — второй не создаём
    const { data: have } = await supabase.from('appliances').select('kind').eq('household_id', household!.id)
    const kinds = new Set((have ?? []).map((x) => x.kind))
    for (const t of THINGS) {
      if (t.appliance && picked.includes(t.key) && !kinds.has(t.key)) {
        const { error } = await supabase.rpc('create_appliance',
          { p_household: household!.id, p_name: t.appliance, p_kind: t.key, p_icon: t.icon })
        if (error) { setBusy(false); return Alert.alert('Ошибка', error.message) }
      }
    }
    const { data: hh } = await supabase.from('households').select('settings').eq('id', household!.id).single()
    await supabase.from('households').update({ settings: { ...(hh?.settings ?? {}), has: picked } }).eq('id', household!.id)
    setBusy(false)
    router.push('/onboarding/voice')
  }

  return (
    <Step n={3} title="ЧТО ЕСТЬ ДОМА?"
      subtitle="Отметь своё. Стиралка, сушилка и посудомойка появятся на главном экране: все будут видеть, что стирка готова и ждёт."
      footer={<Button title="ДАЛЬШЕ" onPress={next} loading={busy} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {THINGS.map((t) => {
          const on = picked.includes(t.key)
          return (
            <Pressable key={t.key} onPress={() => toggle(t.key)} style={{
              width: '48.5%', padding: 14, borderWidth: 2, alignItems: 'center',
              borderColor: on ? colors.green : colors.border, backgroundColor: on ? colors.greenMid : colors.card,
            }}>
              <Body size={30}>{t.icon}</Body>
              <Body weight="medium" color={on ? colors.green : colors.text} style={{ marginTop: 6 }}>{t.label}</Body>
            </Pressable>
          )
        })}
      </View>
    </Step>
  )
}

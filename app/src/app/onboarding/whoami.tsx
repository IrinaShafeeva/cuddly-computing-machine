import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Avatar, Body, Button } from '@/components/ui'

// Вошёл по общему коду дома, а его уже добавили заранее (заготовка) → «Кто ты?»,
// чтобы не было двух Саш. Дела и звёзды заготовки переходят к нему.
export default function WhoAmI() {
  const { household, members, reload } = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  const placeholders = members.filter((m) => m.is_placeholder)

  const pick = async (id: string) => {
    setBusy(id)
    const { error } = await supabase.rpc('merge_person', { p_household: household!.id, p_placeholder: id })
    setBusy(null)
    if (error) return Alert.alert('Не получилось', error.message)
    await reload()
    router.replace('/onboarding/welcome')
  }

  return (
    <Step n={7} title="КТО ТЫ?"
      subtitle="Тебя, возможно, уже добавили в дом. Найди себя — твои дела сразу будут твоими."
      footer={<Button variant="ghost" title="МЕНЯ ТУТ НЕТ" onPress={() => router.replace('/onboarding/welcome')} />}>
      {placeholders.map((p) => (
        <Pressable key={p.id} onPress={() => pick(p.id)} disabled={!!busy}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8,
            borderWidth: 2, borderColor: busy === p.id ? colors.green : colors.border, backgroundColor: colors.card },
            pressed && { opacity: 0.6 }]}>
          <Avatar name={p.display_name} color={p.color} size={36} />
          <Body size={17} weight="bold" style={{ flex: 1 }}>{p.display_name}</Body>
          <Body color={colors.green}>ЭТО Я →</Body>
        </Pressable>
      ))}
      {!placeholders.length && <View />}
    </Step>
  )
}

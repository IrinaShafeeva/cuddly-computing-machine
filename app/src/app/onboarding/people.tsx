import { useState } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useWizard } from '@/lib/wizard'
import { colors } from '@/lib/theme'
import type { Role } from '@/lib/types'
import { Step } from '@/components/Step'
import { Avatar, Body, Button, Chip, Input } from '@/components/ui'

const ROLES: { key: Role; label: string }[] = [
  { key: 'adult', label: 'Взрослый' },
  { key: 'child', label: 'Ребёнок' },
  { key: 'guest', label: 'Няня / помощница' },
]

// Шаг 2: кто живёт дома (люди-заготовки — до установки приложения)
export default function People() {
  const { household, members, reload } = useSession()
  const { addInvite } = useWizard()
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('adult')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim()) return
    setBusy(true)
    const { data, error } = await supabase.rpc('add_person',
      { p_household: household!.id, p_name: name.trim(), p_role: role })
    setBusy(false)
    if (error) return Alert.alert('Ошибка', error.message)
    addInvite({ profile_id: (data as any).profile_id, token: (data as any).token, name: name.trim() })
    setName('')
    await reload()
  }

  return (
    <Step n={2} title="КТО ЖИВЁТ ДОМА?"
      subtitle="Добавь всех, даже если у них пока нет приложения. Дела им можно раздать уже сейчас, а пригласим в конце."
      footer={<Button title={members.length > 1 ? 'ДАЛЬШЕ' : 'ПОКА ТОЛЬКО Я'} onPress={() => router.push('/onboarding/home')} />}>
      {members.map((m) => (
        <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <Avatar name={m.display_name} color={m.color} size={34} />
          <Body weight="medium" style={{ flex: 1 }}>{m.display_name}</Body>
          <Body size={13} color={colors.dim}>{ROLES.find((r) => r.key === m.role)?.label}</Body>
        </View>
      ))}
      <View style={{ marginTop: 20 }}>
        <Input value={name} onChangeText={setName} placeholder="Имя: Саша, Маша, бабушка…" onSubmitEditing={add} returnKeyType="done" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {ROLES.map((r) => <Chip key={r.key} label={r.label} active={role === r.key} onPress={() => setRole(r.key)} />)}
        </View>
        <Button variant="ghost" title="+ ДОБАВИТЬ" onPress={add} loading={busy} disabled={!name.trim()} style={{ marginTop: 6 }} />
      </View>
    </Step>
  )
}

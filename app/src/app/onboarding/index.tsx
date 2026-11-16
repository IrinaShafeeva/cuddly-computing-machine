import { useState } from 'react'
import { Alert } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Body, Button, Input, SectionTitle } from '@/components/ui'

// Шаг 1: создать дом или войти по приглашению
export default function Start() {
  const { me, reload, signOut } = useSession()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

  const create = async () => {
    if (!name.trim()) return Alert.alert('Как назовём дом?')
    setBusy('create')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const { error } = await supabase.rpc('create_household', { p_name: name.trim(), p_timezone: tz })
    if (error) { setBusy(null); return Alert.alert('Ошибка', error.message) }
    await reload()
    setBusy(null)
    router.push('/onboarding/people')
  }

  // Личная ссылка — длинный токен; общий код дома — 8 символов
  const join = async () => {
    const c = code.trim().replace(/^.*invite\//, '')
    if (!c) return Alert.alert('Введи код приглашения')
    setBusy('join')
    const { error } = c.length > 12
      ? await supabase.rpc('accept_invite', { p_token: c })
      : await supabase.rpc('join_household', { p_code: c, p_role: 'adult' })
    setBusy(null)
    if (error) return Alert.alert('Не нашли', 'Проверь код приглашения')
    await reload()
    // По общему коду: если в доме есть «заготовки», спросим «Кто ты?», чтобы не появился двойник
    if (c.length <= 12) {
      const { data: hm } = await supabase.from('household_members').select('household_id').eq('user_id', me!.id).maybeSingle()
      const { count } = await supabase.from('household_members').select('profiles!inner(is_placeholder)', { count: 'exact', head: true })
        .eq('household_id', hm?.household_id ?? '').eq('profiles.is_placeholder', true)
      if (count) return router.replace('/onboarding/whoami')
    }
    router.replace('/onboarding/welcome')
  }

  return (
    <Step n={1} title={`ПРИВЕТ, ${me?.display_name?.toUpperCase() ?? ''}!`}
      subtitle="Пинок делает невидимую работу по дому видимой. И помогает честно её разделить."
      footer={<Button variant="ghost" small title="ВЫЙТИ" onPress={signOut} style={{ borderColor: colors.dimmer }} />}>
      <SectionTitle>НОВЫЙ ДОМ</SectionTitle>
      <Input value={name} onChangeText={setName} placeholder="Например: Шафеевы" />
      <Button title="СОЗДАТЬ ДОМ" onPress={create} loading={busy === 'create'} />

      <SectionTitle>МЕНЯ ПРИГЛАСИЛИ</SectionTitle>
      <Body size={13} color={colors.dim} style={{ marginBottom: 10 }}>Вставь код или ссылку из приглашения</Body>
      <Input value={code} onChangeText={setCode} placeholder="код из сообщения" autoCapitalize="none" />
      <Button variant="ghost" title="ВОЙТИ В ДОМ" onPress={join} loading={busy === 'join'} />
    </Step>
  )
}

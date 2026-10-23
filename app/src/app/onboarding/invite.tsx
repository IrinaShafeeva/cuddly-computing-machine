import { useEffect, useState } from 'react'
import { Share, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Avatar, Body, Button, Pixel } from '@/components/ui'

type Inv = { token: string; placeholder_id: string }

// Шаг 8: позови семью — у каждого своя ссылка, его дела уже ждут
export default function Invite() {
  const { session, household, members, member } = useSession()
  const me = session?.user.id
  const [invites, setInvites] = useState<Inv[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!household) return
    supabase.from('invites').select('token, placeholder_id').eq('household_id', household.id)
      .is('used_by', null).not('placeholder_id', 'is', null)
      .then(({ data }) => setInvites((data ?? []) as Inv[]))
    supabase.from('tasks').select('assignee_id').eq('household_id', household.id).eq('status', 'active')
      .then(({ data }) => {
        const c: Record<string, number> = {}
        for (const t of data ?? []) c[t.assignee_id] = (c[t.assignee_id] ?? 0) + 1
        setCounts(c)
      })
  }, [household])

  const send = (inv: Inv) => {
    const p = member(inv.placeholder_id)
    const n = counts[inv.placeholder_id] ?? 0
    const by = member(me)?.display_name ?? ''
    Share.share({
      message:
        `${by} дал(а) тебе пинок 🦶\n` +
        (n ? `У тебя уже ${n} ${n === 1 ? 'дело' : n < 5 ? 'дела' : 'дел'} в доме «${household?.name}».\n` : `Тебя ждут в доме «${household?.name}».\n`) +
        `\nСкачай Пинок и введи код:\n${inv.token}` +
        (p ? `\n\n(приглашение для: ${p.display_name})` : ''),
    })
  }

  const shareCode = () => Share.share({
    message: `Присоединяйся к дому «${household?.name}» в Пинке 🦶\nКод: ${household?.invite_code}`,
  })

  return (
    <Step n={8} title="ПОЗОВИ СЕМЬЮ"
      subtitle="У каждого своя ссылка. Когда человек зайдёт, его дела уже будут ждать."
      footer={<Button title="ПОЕХАЛИ! 🦶" onPress={() => router.replace('/')} />}>
      {invites.map((inv) => {
        const p = member(inv.placeholder_id)
        if (!p) return null
        return (
          <View key={inv.token} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
            borderBottomWidth: 1, borderColor: colors.border }}>
            <Avatar name={p.display_name} color={p.color} size={36} />
            <View style={{ flex: 1 }}>
              <Body weight="medium">{p.display_name}</Body>
              <Body size={12} color={colors.dim}>дел: {counts[p.id] ?? 0}</Body>
            </View>
            <Button small title="ОТПРАВИТЬ" onPress={() => send(inv)} />
          </View>
        )
      })}
      {!invites.length && (
        <Body color={colors.dim}>
          {members.length > 1 ? 'Все уже в приложении 👏' : 'Можно позвать кого угодно по общему коду дома:'}
        </Body>
      )}
      <View style={{ marginTop: 24, alignItems: 'center' }}>
        <Body size={13} color={colors.dim}>Общий код дома</Body>
        <Pixel size={16} color={colors.green} glow style={{ marginTop: 8 }}>{household?.invite_code}</Pixel>
        <Button variant="ghost" small title="ОТПРАВИТЬ КОД" onPress={shareCode} style={{ marginTop: 10 }} />
      </View>
    </Step>
  )
}

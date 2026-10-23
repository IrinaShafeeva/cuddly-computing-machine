import { useMemo, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { shares, useWizard, type DiagItem } from '@/lib/wizard'
import { buildKickPlan } from '@/lib/plans'
import { colors } from '@/lib/theme'
import type { Recurrence } from '@/lib/types'
import { Step } from '@/components/Step'
import { Avatar, Body, Button, Pixel } from '@/components/ui'

function recurrenceOf(i: DiagItem): Recurrence | null {
  switch (i.freq) {
    case 'daily': return { type: 'daily' }
    case 'weekdays': return { type: 'weekly', days: [1, 2, 3, 4, 5] }
    case 'weekly': return { type: 'weekly', days: [new Date().getDay()] }
    case 'monthly': return { type: 'monthly', day: new Date().getDate() }
    default: return null
  }
}

const FREQ: Record<DiagItem['freq'], string> = {
  daily: 'каждый день', weekdays: 'по будням', weekly: 'раз в неделю', monthly: 'раз в месяц', rarely: 'иногда',
}

// Шаг 7: перераспределить — нажми на человека, и дело станет его. Отмеченные дела создаются сразу
export default function Redistribute() {
  const { session, household, members } = useSession()
  const me = session?.user.id ?? ''
  const w = useWizard()
  const list = useMemo(() => [...w.items].sort((a, b) => b.per_week - a.per_week), [w.items])
  const [assign, setAssign] = useState<Record<string, string | null>>(
    () => Object.fromEntries(w.items.map((i) => [i.id, i.who])))
  const [create, setCreate] = useState<Record<string, boolean>>(
    () => Object.fromEntries(w.items.map((i) => [i.id, i.freq !== 'rarely'])))
  const [busy, setBusy] = useState(false)

  const after = shares(w.items.map((i) => ({ ...i, who: assign[i.id] ?? null })))
  const before = shares(w.items)
  const myBefore = Math.round((before[me]?.share ?? 0) * 100)
  const myAfter = Math.round((after[me]?.share ?? 0) * 100)

  const save = async () => {
    setBusy(true)
    let n = 0
    for (const i of list) {
      const rec = recurrenceOf(i)
      const who = assign[i.id]
      if (!create[i.id] || !rec || !who) continue
      const { error } = await supabase.rpc('create_task', {
        p_household: household!.id, p_title: i.title, p_assignee: who, p_recurrence: rec,
        p_due_at: null, p_due_time: '21:00',
        p_kick_plan: buildKickPlan(i.freq === 'daily' ? 'three' : 'escalate', '21:00', '', false),
        p_icon: i.emoji, p_notes: null, p_appliance: null,
      })
      if (error) { setBusy(false); return Alert.alert('Ошибка', error.message) }
      n++
    }
    setBusy(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Готово', `Создано дел: ${n}`, [{ text: 'Дальше', onPress: () => router.push('/onboarding/invite') }])
  }

  return (
    <Step n={7} title="ПЕРЕРАСПРЕДЕЛИМ?"
      subtitle="Нажми на человека — дело станет его. Галочка — создать дело с пинками."
      footer={<>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
          <Pixel size={14} color={colors.red}>{myBefore}%</Pixel>
          <Pixel size={12} color={colors.dim}>→</Pixel>
          <Pixel size={14} color={myAfter < myBefore ? colors.green : colors.yellow} glow>{myAfter}%</Pixel>
          <Body size={13} color={colors.dim}>на тебе</Body>
        </View>
        <Button title="СОЗДАТЬ ДЕЛА 🦶" onPress={save} loading={busy} />
        <Button variant="ghost" small title="ПОЗЖЕ" onPress={() => router.push('/onboarding/invite')} style={{ borderColor: colors.dimmer }} />
      </>}>
      {list.map((i) => (
        <View key={i.id} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => setCreate({ ...create, [i.id]: !create[i.id] })} hitSlop={8}
              style={{ width: 24, height: 24, borderWidth: 2, borderColor: create[i.id] ? colors.green : colors.dimmer, alignItems: 'center', justifyContent: 'center' }}>
              <Pixel size={9} color={colors.green}>{create[i.id] ? '✓' : ''}</Pixel>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Body weight="medium">{i.emoji ? `${i.emoji} ` : ''}{i.title}{i.invisible ? ' 👻' : ''}</Body>
              <Body size={12} color={colors.dim}>{FREQ[i.freq]}</Body>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {members.map((m) => {
              const on = assign[i.id] === m.id
              return (
                <Pressable key={m.id} onPress={() => { Haptics.selectionAsync(); setAssign({ ...assign, [i.id]: m.id }) }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4, paddingRight: 10,
                    borderWidth: 1, borderColor: on ? m.color : colors.border, opacity: on ? 1 : 0.5 }}>
                  <Avatar name={m.display_name} color={m.color} size={22} />
                  <Body size={13} color={on ? m.color : colors.dim}>{m.id === me ? 'Я' : m.display_name}</Body>
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}
    </Step>
  )
}

import { useState } from 'react'
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { buildKickPlan, kickPresets, parseTimes, type KickPresetKey } from '@/lib/plans'
import { colors } from '@/lib/theme'
import type { Recurrence } from '@/lib/types'
import { Body, Button, Chip, Input, Pixel, SectionTitle } from '@/components/ui'

const ICONS = ['🗑', '🧹', '🍽', '🧺', '🪴', '🐕', '🚗', '🛒', '👶', '📚', '💸', '🔧']
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']   // индекс 0 = Пн → dow 1
const TIMES = ['09:00', '13:00', '18:00', '21:00']

type Repeat = 'once' | 'daily' | 'weekly' | 'every_n_days' | 'monthly'

export default function NewTask() {
  const { session, household, members } = useSession()
  const me = session?.user.id
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [assignee, setAssignee] = useState(me ?? '')
  const [repeat, setRepeat] = useState<Repeat>('once')
  const [days, setDays] = useState<number[]>([])
  const [n, setN] = useState('2')
  const [dayOffset, setDayOffset] = useState(0)        // разовое: сегодня/завтра/…
  const [dueTime, setDueTime] = useState('21:00')
  const [preset, setPreset] = useState<KickPresetKey>('three')
  const [customTimes, setCustomTimes] = useState('')
  const [wakeUp, setWakeUp] = useState(false)
  const [busy, setBusy] = useState(false)

  const toggleDay = (i: number) => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])

  const save = async () => {
    if (!title.trim()) return Alert.alert('Что нужно сделать?')
    if (!parseTimes(dueTime).length) return Alert.alert('Время в формате ЧЧ:ММ')
    if (repeat === 'weekly' && !days.length) return Alert.alert('Выбери дни недели')
    const time = parseTimes(dueTime)[0]

    let recurrence: Recurrence
    let dueAt: string | null = null
    switch (repeat) {
      case 'once': {
        const d = new Date(); d.setDate(d.getDate() + dayOffset)
        const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0)
        dueAt = d.toISOString(); recurrence = { type: 'once' }; break
      }
      case 'daily': recurrence = { type: 'daily' }; break
      case 'weekly': recurrence = { type: 'weekly', days: days.map((i) => (i + 1) % 7) }; break
      case 'every_n_days': recurrence = { type: 'every_n_days', n: Math.max(1, parseInt(n) || 2) }; break
      case 'monthly': recurrence = { type: 'monthly', day: new Date().getDate() }; break
    }

    setBusy(true)
    const { error } = await supabase.rpc('create_task', {
      p_household: household!.id, p_title: title.trim(), p_assignee: assignee,
      p_recurrence: recurrence, p_due_at: dueAt, p_due_time: repeat === 'once' ? null : time,
      p_kick_plan: buildKickPlan(preset, time, customTimes, wakeUp), p_icon: icon,
      p_notes: null, p_appliance: null,
    })
    setBusy(false)
    if (error) return Alert.alert('Ошибка', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled">
      <SectionTitle>ЧТО</SectionTitle>
      <Input value={title} onChangeText={setTitle} placeholder="Вынести мусор" autoFocus />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {ICONS.map((e) => (
          <Pressable key={e} onPress={() => setIcon(icon === e ? null : e)}
            style={{ padding: 6, borderWidth: 1, borderColor: icon === e ? colors.green : 'transparent' }}>
            <Body size={22}>{e}</Body>
          </Pressable>
        ))}
      </View>

      <SectionTitle>КТО</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {members.map((m) => (
          <Chip key={m.id} label={m.id === me ? 'Я' : m.display_name} color={m.color}
            active={assignee === m.id} onPress={() => setAssignee(m.id)} />
        ))}
      </View>

      <SectionTitle>КОГДА ДЕЛАТЬ</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {([['once', 'Один раз'], ['daily', 'Каждый день'], ['weekly', 'По дням'],
          ['every_n_days', 'Каждые N дней'], ['monthly', 'Раз в месяц']] as const).map(([k, l]) => (
          <Chip key={k} label={l} active={repeat === k} onPress={() => setRepeat(k)} />
        ))}
      </View>
      {repeat === 'once' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
          {[['Сегодня', 0], ['Завтра', 1], ['Послезавтра', 2], ['Через неделю', 7]].map(([l, o]) => (
            <Chip key={l} label={l as string} color={colors.yellow} active={dayOffset === o} onPress={() => setDayOffset(o as number)} />
          ))}
        </View>
      )}
      {repeat === 'weekly' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
          {DAYS.map((d, i) => <Chip key={d} label={d} color={colors.yellow} active={days.includes(i)} onPress={() => toggleDay(i)} />)}
        </View>
      )}
      {repeat === 'every_n_days' && (
        <Input label="КАЖДЫЕ … ДНЕЙ" value={n} onChangeText={setN} keyboardType="number-pad" />
      )}
      {repeat === 'monthly' && (
        <Body size={13} color={colors.dim}>Каждое {new Date().getDate()}-е число месяца</Body>
      )}

      <Pixel size={7} color={colors.dim} style={{ marginTop: 14, marginBottom: 8 }}>К КАКОМУ ВРЕМЕНИ</Pixel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        {TIMES.map((t) => <Chip key={t} label={t} color={colors.yellow} active={dueTime === t} onPress={() => setDueTime(t)} />)}
      </View>
      <Input value={dueTime} onChangeText={setDueTime} placeholder="ЧЧ:ММ" keyboardType="numbers-and-punctuation" />

      <SectionTitle>КАК ПИНАТЬ 🦶</SectionTitle>
      {kickPresets.map((p) => (
        <Pressable key={p.key} onPress={() => { Haptics.selectionAsync(); setPreset(p.key) }}
          style={{ borderWidth: 1, borderColor: preset === p.key ? colors.green : colors.border,
            backgroundColor: preset === p.key ? colors.greenMid : colors.card, padding: 12, marginBottom: 6 }}>
          <Body weight="medium" color={preset === p.key ? colors.green : colors.text}>{p.label}</Body>
          <Body size={12} color={colors.dim} style={{ marginTop: 2 }}>{p.hint}</Body>
        </Pressable>
      ))}
      {preset === 'custom' && (
        <Input value={customTimes} onChangeText={setCustomTimes} placeholder="7:30, 12:00, 20:00" />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Body>Будить в тихие часы</Body>
          <Body size={12} color={colors.dim}>обычно ночью пинки не приходят</Body>
        </View>
        <Switch value={wakeUp} onValueChange={setWakeUp} trackColor={{ true: colors.red, false: colors.card2 }} />
      </View>

      <Button title="ДАТЬ ПИНОК 🦶" onPress={save} loading={busy} style={{ marginTop: 28 }} />
    </ScrollView>
  )
}

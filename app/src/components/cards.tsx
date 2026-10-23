import { useRef, useState } from 'react'
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { applianceHeat, ago, dueLabel, flagHeat, occurrenceHeat } from '@/lib/heat'
import { kickLevels } from '@/lib/kicks'
import { colors, heatColor } from '@/lib/theme'
import type { Appliance, Flag, Occurrence } from '@/lib/types'
import { Avatar, Body, Button, HeatCard, Pixel } from './ui'

function fail(e: { message: string } | null) {
  if (e) Alert.alert('Не получилось', e.message)
  return !!e
}

// Всплывающее «+N ⭐» / «COMBO x3»
function usePop() {
  const [text, setText] = useState<string | null>(null)
  const anim = useRef(new Animated.Value(0)).current
  const show = (t: string) => {
    setText(t)
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }).start(() => setText(null))
  }
  const node = text ? (
    <Animated.View pointerEvents="none" style={[s.pop, {
      opacity: anim.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) },
        { scale: anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) }],
    }]}>
      <Pixel size={10} color={colors.gold} glow>{text}</Pixel>
    </Animated.View>
  ) : null
  return { show, node }
}

// ── Дело ──
export function OccurrenceCard({ o, now }: { o: Occurrence; now: number }) {
  const { session, member } = useSession()
  const me = session?.user.id
  const pop = usePop()
  const [busy, setBusy] = useState(false)
  const done = o.status === 'done'
  const heat = done ? 'green' : occurrenceHeat(o, now)
  const assignee = member(o.assignee_id)
  const mine = o.assignee_id === me

  const complete = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('complete_occurrence', { p_occurrence: o.id })
    setBusy(false)
    if (fail(error)) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (data) pop.show(`+${data} ⭐`)
  }

  const kick = async () => {
    // Уровень считает сервер; фразу по уровню подбирает получатель
    const { data: level, error } = await supabase.rpc('send_kick', { p_occurrence: o.id, p_phrase: null })
    if (fail(error)) return
    if (!level) {
      pop.show('Он уже понял 😅')
      return
    }
    const L = level as 1 | 2 | 3 | 4
    Haptics.impactAsync(L >= 3 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium)
    pop.show(L > 1 ? `COMBO x${L}!` : kickLevels[1].name)
  }

  return (
    <HeatCard heat={heat} style={done && { opacity: 0.45 }}>
      <View style={s.row}>
        <Pressable onPress={complete} disabled={busy || done}
          style={[s.check, { borderColor: done ? colors.green : heatColor[heat] }]}>
          <Pixel size={10} color={colors.green}>{done ? '✓' : ''}</Pixel>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Body weight="medium" numberOfLines={2}
            style={done && { textDecorationLine: 'line-through', color: colors.dim }}>
            {o.task.icon ? `${o.task.icon} ` : ''}{o.task.title}
          </Body>
          <Body size={12} color={done ? colors.dim : heat === 'green' ? colors.dim : heatColor[heat]} style={{ marginTop: 3 }}>
            {done ? `сделано · ${member(o.done_by)?.display_name ?? ''}` : o.status === 'missed' ? 'пропущено 💀' : dueLabel(o.due_at, now)}
            {o.task.recurrence.type !== 'once' && !done ? ' · 🔁' : ''}
          </Body>
        </View>
        {assignee && !mine && <Avatar name={assignee.display_name} color={assignee.color} />}
        {!done && !mine && (
          <Pressable onPress={kick} style={({ pressed }) => [s.kick, pressed && { transform: [{ scale: 0.85 }] }]}>
            <Body size={22}>🦶</Body>
          </Pressable>
        )}
      </View>
      {pop.node}
    </HeatCard>
  )
}

// ── Флаг ──
export function FlagCard({ f, now }: { f: Flag; now: number }) {
  const { session, member } = useSession()
  const me = session?.user.id
  const pop = usePop()
  const heat = flagHeat(f, now)
  const author = member(f.created_by)
  const taker = member(f.claimed_by)

  const claim = async () => {
    const { data, error } = await supabase.rpc('claim_flag', { p_flag: f.id })
    if (fail(error)) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    pop.show(`+${data} ⭐`)
  }

  return (
    <HeatCard heat={f.status === 'claimed' ? 'green' : heat}>
      <View style={s.row}>
        <Body size={22}>🚩</Body>
        <View style={{ flex: 1 }}>
          <Body weight="medium" numberOfLines={2}>{f.title}</Body>
          <Body size={12} color={colors.dim} style={{ marginTop: 3 }}>
            {f.status === 'claimed'
              ? `взял(а) ${taker?.display_name ?? ''}`
              : `${author ? author.display_name : 'дом'} · ${f.due_at ? dueLabel(f.due_at, now) : `висит ${ago(f.created_at, now)}`}`}
          </Body>
        </View>
        {f.status === 'open' && <Button small title="БЕРУ!" onPress={claim} />}
        {f.status === 'claimed' && f.claimed_by !== me && taker &&
          <Avatar name={taker.display_name} color={taker.color} />}
      </View>
      {pop.node}
    </HeatCard>
  )
}

// ── Прибор ──
export function ApplianceCard({ a, now }: { a: Appliance; now: number }) {
  const { member } = useSession()
  const pop = usePop()
  const heat = applianceHeat(a, now)
  const idx = a.states.findIndex((st) => st.key === a.state)
  const cur = a.states[idx]
  const next = a.states[(idx + 1) % a.states.length]
  const who = member(a.state_changed_by)

  const advance = async () => {
    const { data, error } = await supabase.rpc('set_appliance_state', { p_appliance: a.id, p_state: null })
    if (fail(error)) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (data) pop.show(`+${data} ⭐`)
  }

  return (
    <HeatCard heat={heat}>
      <View style={s.row}>
        <Body size={26}>{a.icon ?? '🧺'}</Body>
        <View style={{ flex: 1 }}>
          <Body weight="medium">{a.name}</Body>
          <Body size={13} color={heat === 'green' ? colors.green : heatColor[heat]} weight="bold" style={{ marginTop: 2 }}>
            {cur?.label}
          </Body>
          <Body size={11} color={colors.dim} style={{ marginTop: 2 }}>
            {ago(a.state_changed_at, now)}{who ? ` · ${who.display_name}` : ''}
          </Body>
        </View>
        <Button small variant="ghost" title={`→ ${next.label}`} onPress={advance} />
      </View>
      <View style={s.steps}>
        {a.states.map((st, i) => (
          <View key={st.key} style={[s.step, {
            backgroundColor: i === idx ? heatColor[heat] : i < idx ? colors.greenDark : colors.card2,
          }]} />
        ))}
      </View>
      {pop.node}
    </HeatCard>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 28, height: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  kick: { paddingHorizontal: 4 },
  steps: { flexDirection: 'row', gap: 3, marginTop: 10 },
  step: { flex: 1, height: 5 },
  pop: { position: 'absolute', right: 12, top: -6 },
})

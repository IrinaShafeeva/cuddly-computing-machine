import { useRef, useState } from 'react'
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { applianceHeat, ago, dueLabel, flagHeat, occurrenceHeat } from '@/lib/heat'
import { colors, heatColor } from '@/lib/theme'
import type { Appliance, Flag, Occurrence, Task } from '@/lib/types'
import { Avatar, Body, Button, HeatCard, Pixel } from './ui'
import { showKickSent } from './KickFx'
import { Photo } from './Photo'
import { askPhoto } from '@/lib/photos'

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

  const { household } = useSession()
  const author = member(o.task.created_by)
  const complete = async () => {
    // Фото-отчёт: без фото дело не закрыть
    let proof: string | null = null
    if (o.task.proof_photo) {
      proof = await askPhoto(household!.id, 'proof', 'Фото-отчёт: покажи, что сделано')
      if (!proof) return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('complete_occurrence', { p_occurrence: o.id, p_proof: proof })
    setBusy(false)
    if (fail(error)) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (data) pop.show(`+${data} ⭐`)
    // Дело связано с гидом (например «Поменять губку») — обновить фото, чтобы все видели новую
    if (o.task.guide_id) {
      const gid = o.task.guide_id
      Alert.alert('📸 Сфоткать, как теперь выглядит?', 'Фото в гиде обновится — все увидят новое.', [
        { text: 'Не сейчас', style: 'cancel' },
        { text: 'Сфоткать', onPress: async () => {
          const path = await askPhoto(household!.id, 'guide', 'Новое фото для гида')
          if (path) await supabase.rpc('add_guide_photo', { p_guide: gid, p_kind: 'item', p_path: path })
        } },
      ])
    }
  }

  const kick = async () => {
    // Уровень считает сервер (сколько раз пнули подряд за 10 минут); фразу подбирает получатель
    const { data: level, error } = await supabase.rpc('send_kick', { p_occurrence: o.id, p_phrase: null })
    if (fail(error)) return
    if (!level) {
      pop.show('Он уже понял 😅')
      return
    }
    showKickSent({ level: level as 1 | 2 | 3 | 4, to: assignee?.display_name ?? '', title: o.task.title })
  }

  return (
    <HeatCard heat={heat} style={done && { opacity: 0.45 }}>
      <View style={s.row}>
        <Pressable onPress={complete} disabled={busy || done}
          style={[s.check, { borderColor: done ? colors.green : heatColor[heat] }]}>
          <Pixel size={10} color={colors.green}>{done ? '✓' : ''}</Pixel>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/new-task', params: { id: o.task_id } })}>
          <Body weight="medium" numberOfLines={2}
            style={done && { textDecorationLine: 'line-through', color: colors.dim }}>
            {o.task.icon ? `${o.task.icon} ` : ''}{o.task.title}
          </Body>
          <Body size={12} color={done ? colors.dim : heat === 'green' ? colors.dim : heatColor[heat]} style={{ marginTop: 3 }}>
            {done ? `сделано · ${member(o.done_by)?.display_name ?? ''}` : o.status === 'missed' ? 'пропущено 💀' : dueLabel(o.due_at, now)}
            {o.task.recurrence.type !== 'once' && !done ? ' · 🔁' : ''}
            {!done && o.task.proof_photo ? ' · 📸 нужно фото' : ''}
            {!done && o.review === 'rejected' ? ' · ↩ вернули' : ''}
          </Body>
          {done && o.review === 'pending' && (
            <Body size={12} color={colors.yellow} style={{ marginTop: 3 }}>👀 ждёт проверки{author ? ` · ${author.display_name}` : ''}</Body>
          )}
          {done && o.review === 'approved' && <Body size={12} color={colors.green} style={{ marginTop: 3 }}>✅ принято</Body>}
          {!done && o.review === 'rejected' && o.review_note ? (
            <Body size={12} color={colors.red} style={{ marginTop: 3 }}>«{o.review_note}»</Body>
          ) : null}
          {o.task.notes && !done ? (
            <Body size={12} color={colors.dim} numberOfLines={2} style={{ marginTop: 3 }}>{o.task.notes}</Body>
          ) : null}
        </Pressable>
        {(done ? o.proof_path : o.task.photo_path) ? (
          <Photo path={done ? o.proof_path : o.task.photo_path} style={{ width: 44, height: 44 }} />
        ) : null}
        {assignee && !mine && <Avatar name={assignee.display_name} color={assignee.color} />}
        {!done && !mine && <GloveButton onFire={kick} onTap={() => pop.show('Держи 🥊, чтобы пнуть')} />}
      </View>
      {pop.node}
    </HeatCard>
  )
}

// ── На проверку: «Саша говорит: сделано» → принять / вернуть ──
export function ReviewCard({ o, onDone }: { o: Occurrence; onDone?: () => void }) {
  const { member } = useSession()
  const doer = member(o.done_by)
  const [busy, setBusy] = useState(false)
  const send = async (ok: boolean, note?: string) => {
    setBusy(true)
    const { error } = await supabase.rpc('review_occurrence', { p_occurrence: o.id, p_ok: ok, p_note: note ?? null })
    setBusy(false)
    if (fail(error)) return
    Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    onDone?.()
  }
  const reject = () => Alert.prompt('Что не так?', 'Дело вернётся к ' + (doer?.display_name ?? 'исполнителю') + ', звёзды за него заберём.',
    [{ text: 'Отмена', style: 'cancel' }, { text: 'Вернуть ↩', style: 'destructive', onPress: (t?: string) => send(false, t) }],
    'plain-text')
  return (
    <HeatCard heat="yellow">
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Body weight="medium">{o.task.icon ? `${o.task.icon} ` : ''}{o.task.title}</Body>
          <Body size={12} color={colors.dim} style={{ marginTop: 3 }}>
            {doer?.display_name ?? 'Кто-то'} говорит: сделано{o.done_at ? ` · ${ago(o.done_at)}` : ''}
          </Body>
        </View>
        {doer && <Avatar name={doer.display_name} color={doer.color} />}
      </View>
      {o.proof_path ? <Photo path={o.proof_path} style={{ width: '100%', height: 200, marginTop: 10 }} />
        : <Body size={12} color={colors.dimmer} style={{ marginTop: 8 }}>без фото — проверь глазами</Body>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Button small title="ПРИНЯТО ✅" onPress={() => send(true)} loading={busy} style={{ flex: 1 }} />
        <Button small variant="danger" title="НЕ СДЕЛАНО ↩" onPress={reject} style={{ flex: 1 }} />
      </View>
    </HeatCard>
  )
}

// Перчатка: короткое нажатие — подсказка, удержание — замах (перчатка растёт и дрожит) и удар
function GloveButton({ onFire, onTap }: { onFire: () => void; onTap: () => void }) {
  const charge = useRef(new Animated.Value(0)).current
  const fired = useRef(false)
  const start = () => {
    fired.current = false
    Haptics.selectionAsync()
    Animated.timing(charge, { toValue: 1, duration: 450, useNativeDriver: true }).start()
  }
  const end = () => Animated.spring(charge, { toValue: 0, friction: 4, useNativeDriver: true }).start()
  return (
    <Pressable hitSlop={8} delayLongPress={450} onPressIn={start} onPressOut={end}
      onLongPress={() => { fired.current = true; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onFire() }}
      onPress={() => { if (!fired.current) onTap() }} style={s.kick}>
      <Animated.Text style={{ fontSize: 24, transform: [
        { scale: charge.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) },
        { rotate: charge.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ['0deg', '-12deg', '8deg', '-16deg', '-30deg'] }) },
      ] }}>🥊</Animated.Text>
    </Pressable>
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

  const advance = async (to: string | null = null) => {
    const { data, error } = await supabase.rpc('set_appliance_state', { p_appliance: a.id, p_state: to })
    if (fail(error)) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (data) pop.show(`+${data} ⭐`)
  }

  return (
    <HeatCard heat={heat}>
      <View style={s.row}>
        <Body size={26}>{a.icon ?? '🧺'}</Body>
        {/* Нажал на статус — можно поправить, если переключили случайно */}
        <Pressable style={{ flex: 1 }} onPress={() => Alert.alert(`${a.name}: что сейчас?`, who ? `Последним переключил(а): ${who.display_name} · ${ago(a.state_changed_at, now)}` : undefined,
          [...a.states.filter((st) => st.key !== a.state).map((st) => ({ text: st.label, onPress: () => advance(st.key) })),
            { text: 'Отмена', style: 'cancel' as const }])}>
          <Body weight="medium">{a.name}</Body>
          <Body size={13} color={heat === 'green' ? colors.green : heatColor[heat]} weight="bold" style={{ marginTop: 2 }}>
            {cur?.label}
          </Body>
          <Body size={11} color={colors.dim} style={{ marginTop: 2 }}>
            {ago(a.state_changed_at, now)}{who ? ` · ${who.display_name}` : ''}
          </Body>
        </Pressable>
        <Button small variant="ghost" title={`→ ${next.label}`} onPress={() => advance()} />
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
  draft: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.dimmer, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 28, height: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  kick: { paddingHorizontal: 4 },
  steps: { flexDirection: 'row', gap: 3, marginTop: 10 },
  step: { flex: 1, height: 5 },
  pop: { position: 'absolute', right: 12, top: -6 },
})

// ── Черновик дела: серый, без огня и пинков. Нажми — откроется дело, там «В дела» ──
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
export function repeatLabel(r: Task['recurrence']): string {
  switch (r.type) {
    case 'once': return 'один раз'
    case 'daily': return 'каждый день'
    case 'weekly': return r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6)
      ? 'по будням' : r.days.map((d) => DOW[d]).join(', ')
    case 'every_n_days': return `каждые ${r.n} дн.`
    case 'monthly': return `${r.day}-го числа`
  }
}

export function DraftCard({ t, onChange }: { t: Task; onChange?: () => void }) {
  const { member, session } = useSession()
  const who = member(t.assignee_id)
  const remove = async () => {
    Haptics.selectionAsync()
    const { error } = await supabase.rpc('delete_task', { p_task: t.id })
    if (!fail(error)) onChange?.()
  }
  return (
    <Pressable onPress={() => router.push({ pathname: '/new-task', params: { id: t.id } })}
      style={({ pressed }) => [s.draft, pressed && { opacity: 0.6 }]}>
      <View style={{ flex: 1 }}>
        <Body weight="medium" color={colors.dim} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Body>
        <Body size={12} color={colors.dimmer} style={{ marginTop: 3 }}>
          {repeatLabel(t.recurrence)}{who && who.id !== session?.user.id ? ` · ${who.display_name}` : ''}
        </Body>
      </View>
      {who && <Avatar name={who.display_name} color={colors.dimmer} size={26} />}
      <Pressable onPress={remove} hitSlop={10} style={{ paddingHorizontal: 6 }}>
        <Body size={16} color={colors.dimmer}>✕</Body>
      </Pressable>
    </Pressable>
  )
}

import { useMemo, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { mergeItems, shares, uid, useWizard, type DiagItem } from '@/lib/wizard'
import { buildKickPlan } from '@/lib/plans'
import { colors } from '@/lib/theme'
import type { Recurrence } from '@/lib/types'
import { Step } from '@/components/Step'
import { Avatar, Body, Button, Chip, Input, Pixel } from '@/components/ui'

// k — порядковый номер дела этой частоты: недельные раскладываем по дням недели начиная с завтра,
// месячные — по числам месяца, чтобы всё не свалилось на сегодня
function recurrenceOf(i: DiagItem, k: number): Recurrence {
  const today = new Date()
  switch (i.freq) {
    case 'daily': return { type: 'daily' }
    case 'weekdays': return { type: 'weekly', days: [1, 2, 3, 4, 5] }
    case 'weekly': return { type: 'weekly', days: [(today.getDay() + 1 + k) % 7] }
    case 'monthly': return { type: 'monthly', day: ((today.getDate() + 2 + k * 5) % 28) + 1 }
    default: return { type: 'once' }   // «иногда» — разовый черновик, дату поставишь сама
  }
}

const FREQ: Record<DiagItem['freq'], string> = {
  daily: 'каждый день', weekdays: 'по будням', weekly: 'раз в неделю', monthly: 'раз в месяц', rarely: 'иногда',
}
const PER_WEEK: Record<DiagItem['freq'], number> = { daily: 7, weekdays: 5, weekly: 1, monthly: 0.25, rarely: 0.1 }

// Шаг 7: перераспределить — нажми на человека, и дело станет его. Отмеченные дела создаются сразу.
// mode=more — «Дополнить диагностику» из вкладки «Семья»: старые дела уже созданы, создаём только новые
export default function Redistribute() {
  const { session, household, members } = useSession()
  const me = session?.user.id ?? ''
  const w = useWizard()
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const more = mode === 'more'
  const list = useMemo(() => [...w.items].sort((a, b) =>
    Number(!!a.existing) - Number(!!b.existing) || b.per_week - a.per_week), [w.items])
  // Выбор по умолчанию считается на лету — так новые дела («Рассказать ещё») тоже получают его
  const [assign, setAssign] = useState<Record<string, string | null>>({})
  const [create, setCreate] = useState<Record<string, boolean>>({})
  const whoOf = (i: DiagItem) => (i.id in assign ? assign[i.id] : i.who)
  // «Невидимое» (помнить, следить) по умолчанию не дело с пинками — оно считается в «Вот правда»
  const createOf = (i: DiagItem) => (i.id in create ? create[i.id] : !i.existing && !i.invisible)
  const [busy, setBusy] = useState(false)

  // Добавить вручную
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [freq, setFreq] = useState<DiagItem['freq']>('weekly')
  const [invisible, setInvisible] = useState(false)
  const addManual = () => {
    if (!title.trim()) return
    w.setItems((prev) => mergeItems(prev, [{
      id: uid(), title: title.trim(), who: me, freq, per_week: PER_WEEK[freq],
      invisible, emoji: invisible ? '👻' : null, source: 'manual',
    }]))
    Haptics.selectionAsync()
    setTitle(''); setInvisible(false); setAdding(false)
  }

  const after = shares(w.items.map((i) => ({ ...i, who: whoOf(i) })))
  const before = shares(w.items)
  const myBefore = Math.round((before[me]?.share ?? 0) * 100)
  const myAfter = Math.round((after[me]?.share ?? 0) * 100)
  const newCount = w.items.filter((i) => !i.existing).length

  const save = async () => {
    setBusy(true)
    // Отмеченные дела становятся серыми черновиками во вкладке «Дела»: пинков пока нет,
    // каждое можно открыть, поправить и отправить «В дела»
    const k: Record<string, number> = {}
    const drafts = list.filter((i) => createOf(i) && whoOf(i)).map((i) => {
      const recurrence = recurrenceOf(i, k[i.freq] ?? 0)
      k[i.freq] = (k[i.freq] ?? 0) + 1
      return {
        title: i.title, icon: i.emoji, assignee: whoOf(i), recurrence, due_time: '21:00',
        kick_plan: buildKickPlan(i.freq === 'daily' ? 'three' : 'escalate', '21:00', '', false),
      }
    })
    let n = 0
    if (drafts.length) {
      const { data, error } = await supabase.rpc('create_drafts', { p_household: household!.id, p_items: drafts })
      if (error) { setBusy(false); return Alert.alert('Ошибка', error.message) }
      n = data ?? 0
    }
    // «Что у вас обычно заканчивается» из рассказа → на полку «Разное» (переложить можно потом)
    if (w.stock.length) {
      await supabase.rpc('add_stock_items', { p_household: household!.id, p_items: w.stock.map((name) => ({ name, zone: 'other' })) })
    }
    // Новый снимок диагностики: в «Дополнить» всегда, в онбординге — если после «Вот правда» добавились дела
    if (more || (w.savedCount > 0 && w.items.length > w.savedCount)) {
      await supabase.rpc('save_diagnosis', {
        p_household: household!.id,
        p_items: w.items.map(({ id, existing, ...rest }) => rest),
        p_transcript: w.transcript || null,
      })
    }
    setBusy(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const next = () => (more ? router.dismissTo('/family') : router.push('/onboarding/invite'))
    Alert.alert('Готово', n
      ? `Черновиков: ${n}. Они ждут во вкладке «Дела» — открой, поправь время и нажми «В дела».`
      : 'Готово', [{ text: more ? 'К семье' : 'Дальше', onPress: next }])
  }

  return (
    <Step n={7} title={more ? 'ДОПОЛНИМ?' : 'ПЕРЕРАСПРЕДЕЛИМ?'}
      subtitle={more
        ? `Новых дел: ${newCount}. Нажми на человека — дело станет его. Галочка — в черновики дел.`
        : 'Нажми на человека — дело станет его. Галочка — в черновики: потом спокойно поправишь каждое и включишь пинки.'}
      footer={<>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
          <Pixel size={14} color={colors.red}>{myBefore}%</Pixel>
          <Pixel size={12} color={colors.dim}>→</Pixel>
          <Pixel size={14} color={myAfter < myBefore ? colors.green : colors.yellow} glow>{myAfter}%</Pixel>
          <Body size={13} color={colors.dim}>на тебе</Body>
        </View>
        <Button title="В ЧЕРНОВИКИ 📝" onPress={save} loading={busy} />
        {!more && <Button variant="ghost" small title="ПОЗЖЕ" onPress={() => router.push('/onboarding/invite')} style={{ borderColor: colors.dimmer }} />}
      </>}>

      {/* Что-то забыла? */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Button small variant="ghost" title="🎙 РАССКАЗАТЬ ЕЩЁ" style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/onboarding/voice', params: { mode: 'more', from: 'list' } })} />
        <Button small variant="ghost" title="+ ВРУЧНУЮ" style={{ flex: 1 }} onPress={() => setAdding(!adding)} />
      </View>
      {adding && (
        <View style={{ borderWidth: 1, borderColor: colors.green, padding: 12, marginBottom: 16 }}>
          <Input value={title} onChangeText={setTitle} placeholder="Например: Следить за прививками кота" autoFocus onSubmitEditing={addManual} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(Object.keys(FREQ) as DiagItem['freq'][]).map((f) => (
              <Chip key={f} label={FREQ[f]} color={colors.yellow} active={freq === f} onPress={() => setFreq(f)} />
            ))}
          </View>
          <Chip label="👻 невидимое (помнить, следить, напоминать)" active={invisible} onPress={() => setInvisible(!invisible)} />
          <Button small title="ДОБАВИТЬ" onPress={addManual} disabled={!title.trim()} style={{ marginTop: 4 }} />
        </View>
      )}

      {list.map((i) => (
        <View key={i.id} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8,
          opacity: i.existing ? 0.55 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => setCreate({ ...create, [i.id]: !createOf(i) })} hitSlop={8}
              style={{ width: 24, height: 24, borderWidth: 2, borderColor: createOf(i) ? colors.green : colors.dimmer, alignItems: 'center', justifyContent: 'center' }}>
              <Pixel size={9} color={colors.green}>{createOf(i) ? '✓' : ''}</Pixel>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Body weight="medium">{i.emoji ? `${i.emoji} ` : ''}{i.title}{i.invisible ? ' 👻' : ''}</Body>
              <Body size={12} color={colors.dim}>{FREQ[i.freq]}{i.invisible && !createOf(i) ? ' · 👻 считается в отчёт, без пинков' : ''}{i.existing ? ' · было раньше' : i.source === 'manual' ? ' · добавлено вручную' : ''}</Body>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {members.map((m) => {
              const on = whoOf(i) === m.id
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

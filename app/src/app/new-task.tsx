import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { buildKickPlan, kickPresets, parseTimes, type KickPresetKey } from '@/lib/plans'
import { colors } from '@/lib/theme'
import type { Guide, Recurrence, Task } from '@/lib/types'
import { askPhotos } from '@/lib/photos'
import { PhotoStrip, taskPhotos } from '@/components/Photo'
import { VoiceTaskButton, type VoiceTask } from '@/components/VoiceTask'
import { Body, Button, Chip, Input, Pixel, SectionTitle } from '@/components/ui'

const ICONS = ['🗑', '🧹', '🍽', '🧺', '🪴', '🐕', '🚗', '🛒', '👶', '📚', '💸', '🔧']
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']   // индекс 0 = Пн → dow 1
const TIMES = ['09:00', '13:00', '18:00', '21:00']

type Repeat = 'once' | 'daily' | 'weekly' | 'every_n_days' | 'monthly'

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// Новое дело, или редактирование: /new-task?id=<task>
export default function NewTask() {
  const { session, household, members } = useSession()
  const me = session?.user.id
  const { id } = useLocalSearchParams<{ id?: string }>()
  const editing = !!id
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState<Task & { due_at: string | null; due_time: string | null } | null>(null)
  const [notes, setNotes] = useState('')
  const [monthDay, setMonthDay] = useState(String(new Date().getDate()))
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [assignee, setAssignee] = useState(me ?? '')
  const [repeat, setRepeat] = useState<Repeat>('once')
  const [days, setDays] = useState<number[]>([])
  const [n, setN] = useState('2')
  const [dayOffset, setDayOffset] = useState(0)        // разовое: сегодня/завтра/…
  const [dueTime, setDueTime] = useState('21:00')
  const [preset, setPreset] = useState<KickPresetKey | 'keep'>(editing ? 'keep' : 'three')
  const [customTimes, setCustomTimes] = useState('')
  const [wakeUp, setWakeUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [proof, setProof] = useState(false)
  const [review, setReview] = useState(true)   // кто дал дело — тот и проверяет
  const [guideId, setGuideId] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  useEffect(() => {
    if (!household) return
    supabase.from('guides').select('*').eq('household_id', household.id).order('title')
      .then(({ data }) => setGuides((data ?? []) as Guide[]))
  }, [household])

  useEffect(() => {
    navigation.setOptions({ title: editing ? 'Дело' : 'Новое дело' })
    if (!id) return
    supabase.from('tasks').select('*').eq('id', id).maybeSingle().then(({ data: t }) => {
      if (!t) return
      setLoaded(t)
      navigation.setOptions({ title: t.status === 'draft' ? 'Черновик' : 'Дело' })
      setTitle(t.title); setIcon(t.icon); setAssignee(t.assignee_id); setNotes(t.notes ?? '')
      setPhotos(taskPhotos(t)); setProof(!!t.proof_photo); setReview(!!t.needs_review); setGuideId(t.guide_id ?? null)
      const r = t.recurrence as Recurrence
      setRepeat(r.type)
      if (r.type === 'weekly') setDays(r.days.map((d) => (d + 6) % 7))
      if (r.type === 'every_n_days') setN(String(r.n))
      if (r.type === 'monthly') setMonthDay(String(r.day))
      if (r.type === 'once' && t.due_at) { setDayOffset(-1); setDueTime(hm(new Date(t.due_at))) }
      else if (t.due_time) setDueTime(String(t.due_time).slice(0, 5))
    })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDraft = loaded?.status === 'draft'
  const remove = () => Alert.alert(isDraft ? 'Убрать черновик?' : 'Удалить дело?', title, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Удалить', style: 'destructive', onPress: async () => {
      const { error } = await supabase.rpc('delete_task', { p_task: id })
      if (error) return Alert.alert('Ошибка', error.message)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } },
  ])

  // Надиктовала → заполняем форму; дальше можно поправить, прицепить фото и отправить
  const [heard, setHeard] = useState<string | null>(null)
  const fromVoice = (v: VoiceTask) => {
    setHeard(v.transcript)
    setTitle(v.title)
    if (v.notes) setNotes(v.notes)
    if (v.icon) setIcon(v.icon)
    if (v.assignee && members.some((m) => m.id === v.assignee)) setAssignee(v.assignee)
    setRepeat(v.repeat)
    if (v.repeat === 'weekly') setDays(v.days.length ? v.days : [new Date().getDay() === 0 ? 6 : new Date().getDay() - 1])
    if (v.repeat === 'every_n_days') setN(String(v.n))
    if (v.repeat === 'monthly') setMonthDay(String(v.month_day))
    if (v.repeat === 'once') setDayOffset(v.day_offset)
    if (v.due_time) setDueTime(v.due_time)
  }

  const toggleDay = (i: number) => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])

  const save = async (publish = true) => {
    if (!title.trim()) return Alert.alert('Что нужно сделать?')
    if (!parseTimes(dueTime).length) return Alert.alert('Время в формате ЧЧ:ММ')
    if (repeat === 'weekly' && !days.length) return Alert.alert('Выбери дни недели')
    const time = parseTimes(dueTime)[0]

    let recurrence: Recurrence
    let dueAt: string | null = null
    switch (repeat) {
      case 'once': {
        const d = dayOffset === -1 && loaded?.due_at ? new Date(loaded.due_at) : new Date()
        if (dayOffset !== -1) d.setDate(d.getDate() + dayOffset)
        const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0)
        dueAt = d.toISOString(); recurrence = { type: 'once' }; break
      }
      case 'daily': recurrence = { type: 'daily' }; break
      case 'weekly': recurrence = { type: 'weekly', days: days.map((i) => (i + 1) % 7) }; break
      case 'every_n_days': recurrence = { type: 'every_n_days', n: Math.max(1, parseInt(n) || 2) }; break
      case 'monthly': recurrence = { type: 'monthly', day: Math.min(31, Math.max(1, parseInt(monthDay) || 1)) }; break
    }

    setBusy(true)
    const kickPlan = preset === 'keep' ? null : buildKickPlan(preset, time, customTimes, wakeUp)
    const common = {
      p_title: title.trim(), p_assignee: assignee, p_recurrence: recurrence, p_due_at: dueAt,
      p_due_time: repeat === 'once' ? null : time, p_kick_plan: kickPlan, p_icon: icon, p_notes: notes.trim() || null,
    }
    const { data: saved, error } = editing
      ? await supabase.rpc('update_task', { p_task: id, ...common, p_publish: publish })
      : await supabase.rpc('create_task', { p_household: household!.id, ...common, p_appliance: null })
    if (error) { setBusy(false); return Alert.alert('Ошибка', error.message) }
    const taskId = (saved as Task | null)?.id ?? id
    const photosChanged = photos.join('|') !== (loaded ? taskPhotos(loaded) : []).join('|')
    const extrasChanged = photosChanged || proof !== !!loaded?.proof_photo
      || (review && assignee !== me) !== !!loaded?.needs_review || guideId !== (loaded?.guide_id ?? null)
    if (taskId && extrasChanged) {
      const { error: e2 } = await supabase.rpc('set_task_extras', {
        p_task: taskId, p_photo: photos[0] ?? null, p_proof: proof, p_review: review && assignee !== me, p_guide: guideId,
      })
      const { error: e3 } = !e2 && photosChanged
        ? await supabase.rpc('set_task_photos', { p_task: taskId, p_photos: photos }) : { error: null }
      if (e2 || e3) { setBusy(false); return Alert.alert('Фото/проверка не сохранились', (e2 ?? e3)!.message) }
    }
    setBusy(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled">
      {!editing && <View style={{ marginBottom: 4 }}>
        <VoiceTaskButton onParsed={fromVoice} />
        {heard && <Body size={12} color={colors.dim} style={{ marginTop: 8 }}>
          Услышала: «{heard}». Проверь ниже, прицепи фото — и «ДАТЬ ПИНОК».
        </Body>}
      </View>}
      <SectionTitle>ЧТО</SectionTitle>
      <Input value={title} onChangeText={setTitle} placeholder="Вынести мусор" />
      <Input value={notes} onChangeText={setNotes} placeholder="Описание: как, где, что важно (необязательно)" multiline
        style={{ minHeight: 60, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {ICONS.map((e) => (
          <Pressable key={e} onPress={() => setIcon(icon === e ? null : e)}
            style={{ padding: 6, borderWidth: 1, borderColor: icon === e ? colors.green : 'transparent' }}>
            <Body size={22}>{e}</Body>
          </Pressable>
        ))}
      </View>

      <SectionTitle>ФОТО: КАК ДОЛЖНО БЫТЬ</SectionTitle>
      <PhotoStrip paths={photos} onRemove={(i) => setPhotos(photos.filter((_, j) => j !== i))} />
      {photos.length < 5 && (
        <Button small variant="ghost" style={{ marginTop: photos.length ? 8 : 0 }}
          title={photos.length ? `📸 ЕЩЁ ФОТО (${photos.length}/5)` : '📸 ДОБАВИТЬ ФОТО'}
          onPress={async () => {
            const ps = await askPhotos(household!.id, 'task', 'Как должно выглядеть', 5 - photos.length)
            if (ps.length) setPhotos([...photos, ...ps])
          }} />
      )}
      <Body size={12} color={colors.dim} style={{ marginTop: 6 }}>До 5 фото: например, кухня с разных сторон.</Body>

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
          {[...(loaded?.due_at ? [[`Как было (${new Date(loaded.due_at).toLocaleDateString('ru', { day: 'numeric', month: 'short' })})`, -1]] : []),
            ['Сегодня', 0], ['Завтра', 1], ['Послезавтра', 2], ['Через неделю', 7],
            ...(dayOffset > 2 && dayOffset !== 7 ? [[(() => { const d = new Date(); d.setDate(d.getDate() + dayOffset)
              return d.toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' }) })(), dayOffset]] : [])].map(([l, o]) => (
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
        <Input label="КАКОГО ЧИСЛА" value={monthDay} keyboardType="number-pad"
          onChangeText={setMonthDay} />
      )}

      <Pixel size={7} color={colors.dim} style={{ marginTop: 14, marginBottom: 8 }}>К КАКОМУ ВРЕМЕНИ</Pixel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        {TIMES.map((t) => <Chip key={t} label={t} color={colors.yellow} active={dueTime === t} onPress={() => setDueTime(t)} />)}
      </View>
      <Input value={dueTime} onChangeText={setDueTime} placeholder="ЧЧ:ММ" keyboardType="numbers-and-punctuation" />

      <SectionTitle>КАК ПИНАТЬ 🥊</SectionTitle>
      {[...(editing ? [{ key: 'keep' as const, label: 'Как сейчас', hint: 'не менять' }] : []), ...kickPresets].map((p) => (
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

      <SectionTitle>ПРОВЕРКА</SectionTitle>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Body>📸 Фото-отчёт обязателен</Body>
          <Body size={12} color={colors.dim}>без фото «сделано» не нажать</Body>
        </View>
        <Switch value={proof} onValueChange={setProof} trackColor={{ true: colors.green, false: colors.card2 }} />
      </View>
      {assignee !== me && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Body>👀 Я проверяю</Body>
            <Body size={12} color={colors.dim}>кто дал дело — тот и проверяет: «сделано» придёт тебе, принять или вернуть (звёзды заберём)</Body>
          </View>
          <Switch value={review} onValueChange={setReview} trackColor={{ true: colors.green, false: colors.card2 }} />
        </View>
      )}

      {guides.length > 0 && <>
        <SectionTitle>ГИД К ДЕЛУ</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Без гида" active={!guideId} onPress={() => setGuideId(null)} />
          {guides.map((g) => (
            <Chip key={g.id} label={`${g.icon ?? '📘'} ${g.title}`} active={guideId === g.id} onPress={() => setGuideId(g.id)} />
          ))}
        </View>
        <Body size={12} color={colors.dim}>Сделал дело — приложение предложит обновить фото в гиде.</Body>
      </>}

      <Button title={isDraft ? 'В ДЕЛА 🥊' : editing ? 'СОХРАНИТЬ' : 'ДАТЬ ПИНОК 🥊'} onPress={() => save(true)}
        loading={busy} style={{ marginTop: 28 }} />
      {isDraft && (
        <Button variant="ghost" title="ОСТАВИТЬ В ЧЕРНОВИКАХ" onPress={() => save(false)} style={{ marginTop: 12 }} />
      )}
      {editing && (
        <Button variant="danger" title={isDraft ? 'ЭТО НЕ ДЕЛО ✕' : 'УДАЛИТЬ ДЕЛО'} onPress={remove} style={{ marginTop: 12 }} />
      )}
    </ScrollView>
  )
}

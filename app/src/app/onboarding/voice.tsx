import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio'
import { File } from 'expo-file-system'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'
import { supabase } from '@/lib/supabase'
import { mergeItems, uid, useWizard, type DiagItem } from '@/lib/wizard'
import { colors } from '@/lib/theme'
import { forgetRecording, pendingRecordings, uploadRecording, type PendingRecording } from '@/lib/voiceStore'
import { Step } from '@/components/Step'
import { Body, Button, Input, Pixel } from '@/components/ui'

type Parsed = { transcript: string; items: Omit<DiagItem, 'id'>[]; stock: string[]; covered: string[] }

const PROMPTS = [
  'Как проходит твоя обычная неделя по дому?',
  'Что ты делаешь утром и вечером?',
  'О чём ты постоянно помнишь и думаешь?',
  'Кто что делает — и кому приходится напоминать?',
  'Что у вас обычно заканчивается?',
]

// Шаг 4: расскажи голосом (или текстом) → ИИ раскладывает на дела.
// mode=more — «Рассказать ещё»: новые дела добавляются к уже найденным.
// from=list — пришли со списка «Перераспределим» (вернуться назад);
// иначе — из вкладки «Семья»: подтягиваем последнюю диагностику и идём к списку
export default function Voice() {
  const { session, household } = useSession()
  const w = useWizard()
  const { mode, from } = useLocalSearchParams<{ mode?: string; from?: string }>()
  const more = mode === 'more'

  // «Дополнить» из вкладки «Семья»: подтянуть прошлую диагностику
  useEffect(() => {
    if (!more || from === 'list' || w.items.length || !household || !session) return
    supabase.from('diagnoses').select('items').eq('household_id', household.id).eq('user_id', session.user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const prev = ((data?.items ?? []) as Omit<DiagItem, 'id'>[]).map((i) => ({ ...i, id: uid(), existing: true }))
        if (prev.length) w.setItems(() => prev)
      })
  }, [more, household, session]) // eslint-disable-line react-hooks/exhaustive-deps
  // Речь: моно 64 кбит/с (≈0,5 МБ в минуту) и постоянная папка — система не сотрёт запись
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, directory: 'document' })
  const state = useAudioRecorderState(recorder)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const pulse = useRef(new Animated.Value(1)).current
  const [pending, setPending] = useState<PendingRecording[]>([])
  const refreshPending = () => { try { setPending(pendingRecordings()) } catch (e) { console.warn(e) } }
  useEffect(refreshPending, [])

  useEffect(() => {
    if (!state.isRecording) { pulse.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.15, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [state.isRecording, pulse])

  const start = async () => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync()
    if (!granted) return Alert.alert('Нужен микрофон', 'Разреши доступ к микрофону или напиши текстом.')
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const send = async (body: { household_id: string; text?: string }, audio?: File) => {
    setBusy(true)
    try {
      // Сначала запись уходит в хранилище — даже если разбор упадёт, она не потеряется
      const audio_path = audio ? await uploadRecording(audio, session!.user.id) : undefined
      const r = await api<Parsed>('diagnosis-parse', { ...body, audio_path })
      if (audio) forgetRecording(audio)
      const found = r.items.map((i) => ({ ...i, id: uid() }))
      w.setTranscript([w.transcript, r.transcript].filter(Boolean).join('\n\n'))
      w.setItems((prev) => mergeItems(prev, found))
      w.setStock([...new Set([...w.stock, ...r.stock])])
      w.setCovered([...new Set([...w.covered, ...r.covered])])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (!more) router.push('/onboarding/cards')
      else if (from === 'list') router.back()
      else router.replace({ pathname: '/onboarding/redistribute', params: { mode: 'more' } })
    } catch (e: any) {
      Alert.alert('Не получилось разобрать',
        `${e.message}${audio ? '\n\nЗапись сохранена — нажми «Разобрать» на ней, чтобы попробовать ещё раз.' : ''}`)
    } finally {
      setBusy(false)
      refreshPending()
    }
  }

  const stop = async () => {
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (!recorder.uri) return
    send({ household_id: household!.id }, new File(recorder.uri))
  }

  const sendText = () => {
    if (text.trim().length < 20) return Alert.alert('Расскажи чуть подробнее')
    send({ household_id: household!.id, text: text.trim() })
  }

  const sec = Math.floor((state.durationMillis ?? 0) / 1000)

  return (
    <Step n={4} title={more ? 'РАССКАЖИ ЕЩЁ' : 'РАССКАЖИ ГОЛОСОМ'}
      subtitle={more
        ? 'Что ещё вспомнилось? Новые дела добавятся к списку, повторы Пинок уберёт сам.'
        : 'Как подруге, 1–3 минуты. Не надо списков — просто рассказывай. Пинок сам найдёт все дела, даже те, что ты не считаешь работой.'}
      footer={<>
        <Button variant="ghost" small title={typing ? 'ЛУЧШЕ ГОЛОСОМ' : 'НАПИСАТЬ ТЕКСТОМ'} onPress={() => setTyping(!typing)} />
        <Button variant="ghost" small title={more ? 'НАЗАД' : 'ПРОПУСТИТЬ'} style={{ borderColor: colors.dimmer }}
          onPress={() => (more ? router.back() : router.push('/onboarding/cards'))} />
      </>}>
      <View style={{ gap: 8, marginBottom: 24 }}>
        {PROMPTS.map((p) => <Body key={p} color={colors.text}>▸ {p}</Body>)}
      </View>

      {!busy && !state.isRecording && pending.length > 0 && (
        <View style={{ gap: 8, marginBottom: 20, padding: 12, borderWidth: 2, borderColor: colors.yellow }}>
          <Pixel size={9} color={colors.yellow}>📼 НЕРАЗОБРАННЫЕ ЗАПИСИ</Pixel>
          {pending.map((p) => (
            <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Body size={13} color={colors.text} style={{ flex: 1 }}>
                {p.at ? new Date(p.at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Запись'}
                {' · '}{(p.size / 1048576).toFixed(1)} МБ
              </Body>
              <Button small title="РАЗОБРАТЬ" onPress={() => send({ household_id: household!.id }, p.file)} />
            </View>
          ))}
        </View>
      )}

      {busy ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <ActivityIndicator color={colors.green} size="large" />
          <Pixel size={9} color={colors.green} style={{ marginTop: 20 }}>ИЩУ НЕВИДИМЫЙ ТРУД…</Pixel>
        </View>
      ) : typing ? (
        <>
          <Input value={text} onChangeText={setText} multiline style={{ minHeight: 160, textAlignVertical: 'top' }}
            placeholder="Утром собираю Машу в садик, проверяю рюкзак, по дороге думаю, что на ужин…" />
          <Button title="РАЗОБРАТЬ" onPress={sendText} />
        </>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Pressable onPress={state.isRecording ? stop : start} style={{
              width: 130, height: 130, borderRadius: 65, borderWidth: 4,
              borderColor: state.isRecording ? colors.red : colors.green,
              backgroundColor: state.isRecording ? '#2a0b0b' : colors.greenDark,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Body size={50}>{state.isRecording ? '⏹' : '🎙'}</Body>
            </Pressable>
          </Animated.View>
          <Pixel size={10} color={state.isRecording ? colors.red : colors.dim} style={{ marginTop: 18 }}>
            {state.isRecording ? `ЗАПИСЬ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'НАЖМИ И ГОВОРИ'}
          </Pixel>
          {state.isRecording && <Body size={13} color={colors.dim} style={{ marginTop: 8 }}>Нажми ещё раз, когда закончишь</Body>}
        </View>
      )}
    </Step>
  )
}

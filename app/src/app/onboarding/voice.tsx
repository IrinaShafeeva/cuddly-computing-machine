import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio'
import { api, apiConfigured } from '@/lib/api'
import { useSession } from '@/lib/session'
import { uid, useWizard, type DiagItem } from '@/lib/wizard'
import { colors } from '@/lib/theme'
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

// Шаг 4: расскажи голосом (или текстом) → ИИ раскладывает на дела
export default function Voice() {
  const { household } = useSession()
  const w = useWizard()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const state = useAudioRecorderState(recorder)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const pulse = useRef(new Animated.Value(1)).current

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

  const send = async (body: FormData) => {
    setBusy(true)
    try {
      const r = await api<Parsed>('/diagnosis/parse', body)
      w.setTranscript(r.transcript)
      w.setItems(() => r.items.map((i) => ({ ...i, id: uid() })))
      w.setStock(r.stock)
      w.setCovered(r.covered)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.push('/onboarding/cards')
    } catch (e: any) {
      Alert.alert('Не получилось разобрать', e.message)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (!recorder.uri) return
    const fd = new FormData()
    fd.append('household_id', household!.id)
    fd.append('audio', { uri: recorder.uri, name: 'voice.m4a', type: 'audio/m4a' } as any)
    send(fd)
  }

  const sendText = () => {
    if (text.trim().length < 20) return Alert.alert('Расскажи чуть подробнее')
    const fd = new FormData()
    fd.append('household_id', household!.id)
    fd.append('text', text.trim())
    send(fd)
  }

  const sec = Math.floor((state.durationMillis ?? 0) / 1000)

  return (
    <Step n={4} title="РАССКАЖИ ГОЛОСОМ"
      subtitle="Как подруге, 1–3 минуты. Не надо списков — просто рассказывай. Пинок сам найдёт все дела, даже те, что ты не считаешь работой."
      footer={<>
        {!apiConfigured && <Body size={12} color={colors.yellow} style={{ textAlign: 'center' }}>Сервер ещё не подключён — этот шаг пока можно пропустить</Body>}
        <Button variant="ghost" small title={typing ? 'ЛУЧШЕ ГОЛОСОМ' : 'НАПИСАТЬ ТЕКСТОМ'} onPress={() => setTyping(!typing)} />
        <Button variant="ghost" small title="ПРОПУСТИТЬ" onPress={() => router.push('/onboarding/cards')} style={{ borderColor: colors.dimmer }} />
      </>}>
      <View style={{ gap: 8, marginBottom: 24 }}>
        {PROMPTS.map((p) => <Body key={p} color={colors.text}>▸ {p}</Body>)}
      </View>

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

import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Pressable, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { File } from 'expo-file-system'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'
import { forgetRecording, uploadRecording } from '@/lib/voiceStore'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

export type VoiceTask = {
  transcript: string; title: string; notes: string; icon: string | null; assignee: string | null
  repeat: 'once' | 'daily' | 'weekly' | 'every_n_days' | 'monthly'
  days: number[]; n: number; month_day: number; day_offset: number; due_time: string | null
  guide_id?: string | null
}
export type VoiceGuide = { transcript: string; title: string; icon: string | null; place: string; steps: string[] }

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

// Большая кнопка: нажала — говоришь — нажала ещё раз → форма дела заполнилась сама
export function VoiceTaskButton({ onParsed }: { onParsed: (t: VoiceTask) => void }) {
  return <VoiceButton mode="task" hint="«Саше завтра к семи вынести мусор и помыть ведро»" onParsed={onParsed} />
}

// То же для гида: «Губка лежит под раковиной, меняем раз в неделю…» → название, где лежит, шаги
export function VoiceGuideButton({ onParsed }: { onParsed: (g: VoiceGuide) => void }) {
  return <VoiceButton mode="guide" hint="«Губка лежит под раковиной слева. Меняем раз в неделю, старую — в мусор»" onParsed={onParsed} />
}

function VoiceButton<T>({ mode, hint, onParsed }: { mode: 'task' | 'guide'; hint: string; onParsed: (t: T) => void }) {
  const { session, household } = useSession()
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, directory: 'document' })
  const state = useAudioRecorderState(recorder)
  const [busy, setBusy] = useState(false)
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!state.isRecording) { pulse.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.06, duration: 450, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [state.isRecording, pulse])

  const start = async () => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync()
    if (!granted) return Alert.alert('Нужен микрофон', 'Разреши микрофон в настройках телефона или напиши текстом.')
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const stop = async () => {
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!recorder.uri) return
    const file = new File(recorder.uri)
    setBusy(true)
    try {
      const audio_path = await uploadRecording(file, session!.user.id)
      const d = new Date()
      const now = `${d.toLocaleDateString('sv')} ${d.toTimeString().slice(0, 5)}, ${WD[d.getDay()]}`
      const r = await api<T>('task-parse', { household_id: household!.id, audio_path, now, mode })
      forgetRecording(file)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onParsed(r)
    } catch (e: any) {
      Alert.alert('Не получилось разобрать', e.message)
    } finally {
      setBusy(false)
    }
  }

  const rec = state.isRecording
  const sec = Math.floor((state.durationMillis ?? 0) / 1000)
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable disabled={busy} onPress={rec ? stop : start}
        style={{ borderWidth: 2, borderColor: rec ? colors.red : colors.green, backgroundColor: rec ? '#3a0d0d' : colors.greenMid,
          paddingVertical: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {busy ? <ActivityIndicator color={colors.green} /> : <Body size={30}>{rec ? '⏹' : '🎙'}</Body>}
        <View style={{ flex: 1 }}>
          <Pixel size={9} color={rec ? colors.red : colors.green}>
            {busy ? 'РАЗБИРАЮ…' : rec ? `ГОВОРИ… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'СКАЖИ ГОЛОСОМ'}
          </Pixel>
          <Body size={12} color={colors.dim} style={{ marginTop: 4 }}>
            {rec ? 'Нажми ещё раз, когда закончишь' : hint}
          </Body>
        </View>
      </Pressable>
    </Animated.View>
  )
}

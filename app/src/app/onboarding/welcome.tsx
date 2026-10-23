import { useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Body, Button, Pixel } from '@/components/ui'

const SLIDES = [
  { icon: '🦶', title: 'ПИНКИ', text: 'Если забыл про дело — тебя пнут. По расписанию или вручную. Сделал быстро после пинка — бонусные звёзды.' },
  { icon: '🚩', title: 'ФЛАГИ', text: '«Стирка готова — кто разберёт?» Кто первый нажал «Беру!», тот и делает. Чем дольше флаг горел, тем больше звёзд.' },
  { icon: '⭐', title: 'ЗВЁЗДЫ', text: 'За всё: сделал, заметил, взял флаг, разобрал стирку. Первый, кто наберёт 50 ⭐, выбирает фильм на вечер!' },
]

// Для приглашённого: «добро пожаловать в команду» + 3 карточки обучения
export default function Welcome() {
  const { household } = useSession()
  const [i, setI] = useState(0)
  const s = SLIDES[i]
  const last = i === SLIDES.length - 1
  return (
    <Step n={8} title="ДОБРО ПОЖАЛОВАТЬ!" subtitle={`Ты в команде дома «${household?.name ?? ''}». Вот как тут всё устроено:`}
      footer={<Button title={last ? 'К МОИМ ДЕЛАМ' : 'ДАЛЬШЕ'} onPress={() => (last ? router.replace('/') : setI(i + 1))} />}>
      <View style={{ alignItems: 'center', borderWidth: 2, borderColor: colors.green, backgroundColor: colors.card, padding: 28 }}>
        <Body size={64}>{s.icon}</Body>
        <Pixel size={14} color={colors.green} glow style={{ marginTop: 16 }}>{s.title}</Pixel>
        <Body size={16} style={{ textAlign: 'center', marginTop: 14, lineHeight: 23 }}>{s.text}</Body>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }}>
        {SLIDES.map((_, k) => <View key={k} style={{ width: 10, height: 10, backgroundColor: k === i ? colors.green : colors.card2 }} />)}
      </View>
    </Step>
  )
}

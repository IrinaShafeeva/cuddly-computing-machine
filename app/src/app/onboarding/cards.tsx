import { useRef, useState } from 'react'
import { Animated, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { INVISIBLE_CARDS } from '@/lib/cards'
import { useSession } from '@/lib/session'
import { uid, useWizard } from '@/lib/wizard'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Body, Button, Pixel } from '@/components/ui'

// Шаг 5: «Это тоже ты?» — карточки невидимого труда по одной
export default function Cards() {
  const { session, members } = useSession()
  const me = session?.user.id
  const w = useWizard()
  const deck = INVISIBLE_CARDS.filter((c) => !w.covered.includes(c.key))
  const [i, setI] = useState(0)
  const slide = useRef(new Animated.Value(0)).current
  const card = deck[i]

  const answer = (who: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (who) {
      w.setItems((prev) => [...prev, {
        id: uid(), title: card.title, who, freq: card.per_week >= 5 ? 'daily' : card.per_week >= 1 ? 'weekly' : 'monthly',
        per_week: card.per_week, invisible: true, emoji: card.emoji, source: 'card',
      }])
    }
    Animated.timing(slide, { toValue: 1, duration: 160, useNativeDriver: true }).start(() => {
      slide.setValue(0)
      if (i + 1 >= deck.length) router.push('/onboarding/truth')
      else setI(i + 1)
    })
  }

  if (!card) {
    return (
      <Step n={5} title="ЭТО ТОЖЕ ТЫ?" footer={<Button title="ДАЛЬШЕ" onPress={() => router.push('/onboarding/truth')} />}>
        <Body color={colors.dim}>Ты уже всё рассказала 👏</Body>
      </Step>
    )
  }

  const others = members.filter((m) => m.id !== me)

  return (
    <Step n={5} title="ЭТО ТОЖЕ ТЫ?"
      subtitle="Невидимую работу обычно не называют — потому что не считают работой. А это она."
      footer={<Button variant="ghost" small title="ХВАТИТ, ДАЛЬШЕ" onPress={() => router.push('/onboarding/truth')} style={{ borderColor: colors.dimmer }} />}>
      <Pixel size={8} color={colors.dim} style={{ textAlign: 'center' }}>{i + 1} / {deck.length}</Pixel>
      <Animated.View style={{
        marginTop: 14, borderWidth: 2, borderColor: colors.green, backgroundColor: colors.card,
        padding: 24, alignItems: 'center', minHeight: 220, justifyContent: 'center',
        opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) }],
      }}>
        <Body size={56}>{card.emoji}</Body>
        <Body size={20} weight="bold" style={{ textAlign: 'center', marginTop: 16 }}>{card.title}</Body>
        <Body size={13} color={colors.dim} style={{ marginTop: 10 }}>Кто это делает сейчас?</Body>
      </Animated.View>
      <View style={{ gap: 8, marginTop: 18 }}>
        <Button title="Я 🙋‍♀️" onPress={() => answer(me ?? null)} />
        {others.map((m) => (
          <Button key={m.id} variant="ghost" title={m.display_name.toUpperCase()} onPress={() => answer(m.id)} />
        ))}
        <Button variant="ghost" small title="НЕТ ТАКОГО" onPress={() => answer(null)} style={{ borderColor: colors.dimmer }} />
      </View>
    </Step>
  )
}

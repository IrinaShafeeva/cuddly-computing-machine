import { useEffect, useRef, useState } from 'react'
import { Animated, Switch, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { shares, useWizard } from '@/lib/wizard'
import { colors } from '@/lib/theme'
import { Step } from '@/components/Step'
import { Body, Button, Pixel, SectionTitle } from '@/components/ui'

// Шаг 6: «Вот правда» — доля нагрузки цифрой. Видит только автор; поделиться — по желанию
export default function Truth() {
  const { session, household, members } = useSession()
  const me = session?.user.id ?? ''
  const w = useWizard()
  const s = shares(w.items)
  const mine = s[me] ?? { total: 0, invisible: 0, share: 0 }
  const pct = Math.round(mine.share * 100)
  const [diagId, setDiagId] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const count = useRef(new Animated.Value(0)).current
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!w.items.length) return
    supabase.rpc('save_diagnosis', {
      p_household: household!.id,
      p_items: w.items.map(({ id, ...rest }) => rest),
      p_transcript: w.transcript || null,
    }).then(({ data }) => setDiagId((data as any)?.id ?? null))
    // Цифра «набегает», телефон вибрирует в конце
    const sub = count.addListener(({ value }) => setShown(Math.round(value)))
    Animated.timing(count, { toValue: pct, duration: 1600, useNativeDriver: false }).start(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning))
    return () => count.removeListener(sub)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleShare = async (v: boolean) => {
    setShared(v)
    if (diagId) await supabase.from('diagnoses').update({ shared: v }).eq('id', diagId)
  }

  if (!w.items.length) {
    return (
      <Step n={6} title="ВОТ ПРАВДА" footer={<Button title="ДАЛЬШЕ" onPress={() => router.push('/onboarding/invite')} />}>
        <Body color={colors.dim}>Дел пока нет — диагностику можно пройти позже во вкладке «Семья».</Body>
      </Step>
    )
  }

  const rows = members.map((m) => ({ m, v: s[m.id] ?? { total: 0, invisible: 0, share: 0 } }))
    .sort((a, b) => b.v.share - a.v.share)
  const color = pct >= 60 ? colors.red : pct >= 45 ? colors.yellow : colors.green

  return (
    <Step n={6} title="ВОТ ПРАВДА"
      footer={<Button title="ДАВАЙ ПЕРЕРАСПРЕДЕЛИМ" onPress={() => router.push('/onboarding/redistribute')} />}>
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Body color={colors.dim}>На тебе</Body>
        <Pixel size={64} color={color} glow style={{ marginTop: 10, lineHeight: 80 }}>{shown}%</Pixel>
        <Body color={colors.dim}>всей работы по дому</Body>
        <Body size={17} weight="medium" style={{ textAlign: 'center', marginTop: 18 }}>
          ≈ {Math.round(mine.total)} дел в неделю, из них{' '}
          <Body size={17} weight="bold" color={colors.yellow}>{Math.round(mine.invisible)} невидимых 👻</Body>
        </Body>
      </View>

      <SectionTitle>КАК СЕЙЧАС</SectionTitle>
      {rows.map(({ m, v }) => (
        <View key={m.id} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body weight="medium" color={m.color}>{m.id === me ? 'Я' : m.display_name}</Body>
            <Body color={colors.dim}>{Math.round(v.share * 100)}%</Body>
          </View>
          <View style={{ height: 14, backgroundColor: colors.card2, marginTop: 6, flexDirection: 'row' }}>
            <View style={{ width: `${(v.share - (v.total ? v.share * v.invisible / v.total : 0)) * 100}%`, backgroundColor: m.color }} />
            <View style={{ width: `${(v.total ? v.share * v.invisible / v.total : 0) * 100}%`, backgroundColor: m.color, opacity: 0.4 }} />
          </View>
        </View>
      ))}
      <Body size={12} color={colors.dim}>Яркое — видимые дела, бледное — невидимые</Body>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Body weight="medium">Показать семье</Body>
          <Body size={12} color={colors.dim}>Пока это видишь только ты</Body>
        </View>
        <Switch value={shared} onValueChange={toggleShare} trackColor={{ true: colors.green, false: colors.card2 }} />
      </View>
    </Step>
  )
}

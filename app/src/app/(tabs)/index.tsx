import { useState } from 'react'
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useSession } from '@/lib/session'
import { useHouseData } from '@/lib/useHouseData'
import { applianceHeat, flagHeat, heatRank, occurrenceHeat } from '@/lib/heat'
import { colors } from '@/lib/theme'
import { ApplianceCard, FlagCard, OccurrenceCard } from '@/components/cards'
import { Body, Empty, Pixel, SectionTitle } from '@/components/ui'

const WEEK_GOAL = 500

export default function Home() {
  const { session, household } = useSession()
  const me = session?.user.id
  const d = useHouseData()
  const [menu, setMenu] = useState(false)

  const open = d.occurrences.filter((o) => o.status !== 'done')
  const byHeat = <T,>(list: T[], heat: (x: T) => keyof typeof heatRank) =>
    [...list].sort((a, b) => heatRank[heat(a)] - heatRank[heat(b)])

  const mine = byHeat(open.filter((o) => o.assignee_id === me), (o) => occurrenceHeat(o, d.now))
  const others = byHeat(open.filter((o) => o.assignee_id !== me), (o) => occurrenceHeat(o, d.now))
  const doneToday = d.occurrences.filter((o) => o.status === 'done')
  const flags = byHeat(d.flags.filter((f) => f.status === 'open'), (f) => flagHeat(f, d.now))
  const appliances = byHeat(d.appliances, (a) => applianceHeat(a, d.now))

  const burning =
    open.filter((o) => ['red', 'fire'].includes(occurrenceHeat(o, d.now))).length +
    flags.filter((f) => ['red', 'fire'].includes(flagHeat(f, d.now))).length +
    d.appliances.filter((a) => ['red', 'fire'].includes(applianceHeat(a, d.now))).length

  const familyWeek = Object.values(d.weekStars).reduce((a, b) => a + b, 0)
  const pct = Math.min(100, Math.round((familyWeek / WEEK_GOAL) * 100))

  const go = (path: '/new-task' | '/new-flag' | '/new-appliance') => { setMenu(false); router.push(path) }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={d.reload} tintColor={colors.green} />}>
        <View style={s.header}>
          <Pixel size={18} color="#fff" glow style={{ textShadowColor: colors.green }}>ПИНОК</Pixel>
          <Pixel size={11} color={colors.gold}>⭐ {d.stars[me ?? ''] ?? 0}</Pixel>
        </View>
        <Body size={13} color={colors.dim} style={{ marginTop: 4 }}>{household?.name}</Body>

        {/* Статус дома */}
        <View style={[s.status, { borderColor: burning ? colors.red : colors.green }]}>
          <Pixel size={9} color={burning ? colors.red : colors.green} glow>
            {burning ? `🔥 ГОРИТ: ${burning}` : '🟢 ДОМ В ПОРЯДКЕ'}
          </Pixel>
        </View>

        {/* Цель недели — XP-бар из Mini App */}
        <Pixel size={7} color={colors.dim} style={{ textAlign: 'center', marginTop: 16, letterSpacing: 2 }}>
          ЦЕЛЬ НЕДЕЛИ · {familyWeek}/{WEEK_GOAL} ⭐ → ПИЦЦА-ВЕЧЕР
        </Pixel>
        <View style={s.xpOuter}>
          <View style={[s.xpInner, { width: `${Math.max(pct, 2)}%` }]} />
          <Pixel size={8} color="#fff" style={s.xpPct}>{pct}%</Pixel>
        </View>

        <SectionTitle>ПРИБОРЫ</SectionTitle>
        {appliances.length
          ? appliances.map((a) => <ApplianceCard key={a.id} a={a} now={d.now} />)
          : <Empty icon="🧺" text="Добавь стиралку через «+»" />}

        <SectionTitle>ФЛАГИ · КТО ВОЗЬМЁТ?</SectionTitle>
        {flags.length
          ? flags.map((f) => <FlagCard key={f.id} f={f} now={d.now} />)
          : <Empty icon="🏳️" text="Никто ничего не просит. Подозрительно." />}

        <SectionTitle>МОИ ДЕЛА</SectionTitle>
        {mine.length
          ? mine.map((o) => <OccurrenceCard key={o.id} o={o} now={d.now} />)
          : <Empty icon="😎" text="У тебя всё сделано" />}

        {others.length > 0 && <>
          <SectionTitle>ДЕЛА СЕМЬИ · МОЖНО ПНУТЬ</SectionTitle>
          {others.map((o) => <OccurrenceCard key={o.id} o={o} now={d.now} />)}
        </>}

        {doneToday.length > 0 && <>
          <SectionTitle>СДЕЛАНО СЕГОДНЯ</SectionTitle>
          {doneToday.map((o) => <OccurrenceCard key={o.id} o={o} now={d.now} />)}
        </>}
      </ScrollView>

      {/* Центральная «+» */}
      <Pressable style={s.fab} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMenu(true) }}>
        <Pixel size={22} color="#000">+</Pixel>
      </Pressable>

      <Modal transparent visible={menu} animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.backdrop} onPress={() => setMenu(false)}>
          <View style={s.sheet}>
            {([
              ['✅', 'ДЕЛО', 'кому-то конкретному, с пинками', '/new-task'],
              ['🚩', 'ФЛАГ', 'кто возьмёт? / нужно к сроку', '/new-flag'],
              ['🧺', 'ПРИБОР', 'стиралка, посудомойка…', '/new-appliance'],
            ] as const).map(([e, t, sub, path]) => (
              <Pressable key={path} style={s.sheetRow} onPress={() => go(path)}>
                <Body size={26}>{e}</Body>
                <View>
                  <Pixel size={11} color={colors.green}>{t}</Pixel>
                  <Body size={13} color={colors.dim} style={{ marginTop: 4 }}>{sub}</Body>
                </View>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  status: { borderWidth: 2, padding: 12, alignItems: 'center', marginTop: 16 },
  xpOuter: { borderWidth: 2, borderColor: colors.green, backgroundColor: colors.greenDark, height: 28, padding: 3, marginTop: 8, justifyContent: 'center' },
  xpInner: { height: '100%', backgroundColor: colors.green },
  xpPct: { position: 'absolute', right: 10 },
  fab: {
    position: 'absolute', bottom: 20, alignSelf: 'center', width: 62, height: 62, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#000',
    shadowColor: colors.green, shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopWidth: 2, borderColor: colors.green, padding: 16, paddingBottom: 40 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
})

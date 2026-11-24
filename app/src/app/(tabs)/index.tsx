import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useSession } from '@/lib/session'
import { useHouseData } from '@/lib/useHouseData'
import { applianceHeat, flagHeat, heatRank, occurrenceHeat } from '@/lib/heat'
import { colors } from '@/lib/theme'
import { ApplianceTile, FlagCard, OccurrenceCard, ReviewCard } from '@/components/cards'
import { Body, Button, Chip, Empty, Input, Pixel, SectionTitle } from '@/components/ui'
import { supabase } from '@/lib/supabase'

const PRIZES = ['🍕 Пицца-вечер', '🎬 Кино дома', '🍦 Мороженое всем', '🛌 Лентяйский день', '💆 Массаж от семьи']

export default function Home() {
  const { session, household, members } = useSession()
  const me = session?.user.id
  const adult = members.find((m) => m.id === me)?.role === 'adult'
  const [goalEdit, setGoalEdit] = useState(false)
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
  const pct = d.goal ? Math.min(100, Math.round((familyWeek / d.goal.stars) * 100)) : 0

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

        {/* Статус дома: считается сам — горит, если что-то просрочено */}
        <Pressable onPress={() => Alert.alert(burning ? '🔥 Что-то горит' : '🟢 Дом в порядке',
          'Это считается само. Зелёный — ничего не просрочено: дела в срок, флаги взяты, стирка не залежалась.\n\n'
          + 'Если дело просрочено или прибор ждёт слишком долго — загорится 🔥 и число: сколько всего горит. Карточки, которые горят, — красные.')}
          style={[s.status, { borderColor: burning ? colors.red : colors.green }]}>
          <Pixel size={9} color={burning ? colors.red : colors.green} glow>
            {burning ? `🔥 ГОРИТ: ${burning}` : '🟢 ДОМ В ПОРЯДКЕ'}
          </Pixel>
          <Body size={11} color={colors.dim} style={{ marginTop: 6 }}>
            {burning ? 'просрочено — нажми, чтобы понять' : 'ничего не просрочено · что это?'}
          </Body>
        </Pressable>

        {/* Цель недели: семья копит звёзды на общую награду. Ставит взрослый */}
        {d.goal ? (
          <Pressable disabled={!adult} onPress={() => setGoalEdit(true)}>
            <Pixel size={7} color={pct >= 100 ? colors.gold : colors.dim} style={{ textAlign: 'center', marginTop: 16, letterSpacing: 2 }}>
              {pct >= 100 ? `🎉 ЦЕЛЬ ВЗЯТА! → ${d.goal.prize.toUpperCase()}` : `ЦЕЛЬ НЕДЕЛИ · ${familyWeek}/${d.goal.stars} ⭐ → ${d.goal.prize.toUpperCase()}`}
            </Pixel>
            <View style={s.xpOuter}>
              <View style={[s.xpInner, { width: `${Math.max(pct, 2)}%` }]} />
              <Pixel size={8} color="#fff" style={s.xpPct}>{pct}%</Pixel>
            </View>
            <Body size={11} color={colors.dimmer} style={{ textAlign: 'center', marginTop: 4 }}>
              звёзды всей семьи за 7 дней{adult ? ' · нажми, чтобы поменять' : ''}
            </Body>
          </Pressable>
        ) : adult ? (
          <Pressable onPress={() => setGoalEdit(true)}
            style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.dimmer, padding: 12, marginTop: 16 }}>
            <Body weight="medium">🎯 Поставить цель недели</Body>
            <Body size={12} color={colors.dim} style={{ marginTop: 4 }}>
              Вся семья копит звёзды за дела — и вместе получает награду: пицца, кино, что придумаешь.
            </Body>
          </Pressable>
        ) : null}

        {d.reviews.length > 0 && <>
          <SectionTitle>👀 НА ПРОВЕРКУ · {d.reviews.length}</SectionTitle>
          {d.reviews.map((o) => <ReviewCard key={o.id} o={o} onDone={d.reload} />)}
        </>}

        <SectionTitle>ПРИБОРЫ</SectionTitle>
        {appliances.length
          ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {appliances.map((a) => <ApplianceTile key={a.id} a={a} now={d.now} onChanged={d.reload} />)}
            </View>
          : <Empty icon="🧺" text="Добавь стиралку через «+»" />}

        <SectionTitle>ФЛАГИ · КТО ВОЗЬМЁТ?</SectionTitle>
        {flags.length
          ? flags.map((f) => <FlagCard key={f.id} f={f} now={d.now} />)
          : <Empty icon="🏳️" text="Никто ничего не просит. Подозрительно." />}

        {d.drafts.length > 0 && (
          <Pressable onPress={() => router.push('/tasks')}
            style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.dimmer, padding: 12, marginTop: 16 }}>
            <Body color={colors.dim}>📝 Черновиков: {d.drafts.length} — разбери, когда будет минутка →</Body>
          </Pressable>
        )}

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

      {goalEdit && <GoalSheet goal={d.goal} settings={d.settings} householdId={household!.id}
        onClose={(changed) => { setGoalEdit(false); if (changed) d.reload() }} />}
    </SafeAreaView>
  )
}

// Цель недели: сколько звёзд и какая награда. Хранится в настройках семьи
function GoalSheet({ goal, settings, householdId, onClose }: {
  goal: { stars: number; prize: string } | null; settings: Record<string, any>; householdId: string
  onClose: (changed: boolean) => void
}) {
  const [stars, setStars] = useState(String(goal?.stars ?? 150))
  const [prize, setPrize] = useState(goal?.prize ?? PRIZES[0])
  const [busy, setBusy] = useState(false)
  const save = async (value: { stars: number; prize: string } | null) => {
    setBusy(true)
    const { error } = await supabase.from('households').update({ settings: { ...settings, weekly_goal: value } }).eq('id', householdId)
    setBusy(false)
    if (error) return Alert.alert('Не получилось', error.message)
    onClose(true)
  }
  const n = parseInt(stars, 10)
  return (
    <Modal transparent visible animationType="slide" onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={() => onClose(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Pixel size={11} color={colors.green}>🎯 ЦЕЛЬ НЕДЕЛИ</Pixel>
            <Body size={13} color={colors.dim} style={{ marginTop: 8 }}>
              За каждое дело — звёзды (3–5 ⭐). Набрали всей семьей за 7 дней — награда. Для двоих 100–150 ⭐ — реально, но надо постараться.
            </Body>
            <SectionTitle>СКОЛЬКО ЗВЁЗД</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[80, 150, 250, 400].map((v) => <Chip key={v} label={`${v} ⭐`} active={n === v} onPress={() => setStars(String(v))} />)}
            </View>
            <Input value={stars} onChangeText={setStars} keyboardType="number-pad" placeholder="150" />
            <SectionTitle>НАГРАДА</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {PRIZES.map((p) => <Chip key={p} label={p} active={prize === p} onPress={() => setPrize(p)} />)}
            </View>
            <Input value={prize} onChangeText={setPrize} placeholder="Своё: поход в аквапарк" />
            <Button title="СОХРАНИТЬ" loading={busy} style={{ marginTop: 16 }}
              onPress={() => (n > 0 && prize.trim() ? save({ stars: n, prize: prize.trim() }) : Alert.alert('Сколько звёзд и какая награда?'))} />
            {goal && <Button variant="ghost" title="УБРАТЬ ЦЕЛЬ" style={{ marginTop: 10 }} onPress={() => save(null)} />}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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

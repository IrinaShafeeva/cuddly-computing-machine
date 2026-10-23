import { useCallback, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useHouseData } from '@/lib/useHouseData'
import { ago } from '@/lib/heat'
import { kickLevels } from '@/lib/kicks'
import { colors } from '@/lib/theme'
import type { Activity } from '@/lib/types'
import { Avatar, Body, Button, Pixel, SectionTitle } from '@/components/ui'

const TITLES = [
  { verb: 'flag_raised', name: 'Глаз-алмаз', icon: '👁', hint: 'больше всех заметил' },
  { verb: 'flag_claimed', name: 'Спасатель', icon: '🛟', hint: 'больше всех взял флагов' },
  { verb: 'appliance_state', name: 'Хозяин стирки', icon: '🧺', hint: 'больше всех крутил приборы' },
  { verb: 'kick', name: 'Главный пинатель', icon: '🦶', hint: 'больше всех пинал' },
]

export default function Family() {
  const { session, household, members, member, signOut } = useSession()
  const me = session?.user.id
  const d = useHouseData()

  // Отчёт по дому: сделал · заметил · спланировал · напомнил
  type Row = { user_id: string; done: number; noticed: number; planned: number; reminded: number; total: number; share: number }
  const [report, setReport] = useState<Row[]>([])
  useFocusEffect(useCallback(() => {
    if (!household) return
    supabase.rpc('house_report', { p_household: household.id }).then(({ data }) =>
      setReport(((data ?? []) as Row[]).sort((a, b) => Number(b.share) - Number(a.share))))
  }, [household, d.activity.length]))

  const ranked = [...members].sort((a, b) => (d.weekStars[b.id] ?? 0) - (d.weekStars[a.id] ?? 0))
  const weekAgo = d.now - 7 * 86400_000
  const titles = TITLES.map((t) => {
    const counts: Record<string, number> = {}
    for (const a of d.activity) {
      if (a.verb === t.verb && a.actor_id && new Date(a.created_at).getTime() > weekAgo)
        counts[a.actor_id] = (counts[a.actor_id] ?? 0) + 1
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return { ...t, holder: top ? member(top[0]) : undefined }
  })

  const invite = () => Share.share({
    message: `Присоединяйся к нашему дому «${household?.name}» в Пинке! Код: ${household?.invite_code}`,
  })

  const thanks = async (a: Activity) => {
    const { error } = await supabase.rpc('say_thanks', { p_activity: a.id })
    if (error) return Alert.alert('Ошибка', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={d.reload} tintColor={colors.green} />}>
        <Pixel size={16} color="#fff" glow style={{ textShadowColor: colors.green, marginTop: 8 }}>СЕМЬЯ</Pixel>
        <Body color={colors.dim} style={{ marginTop: 4 }}>{household?.name}</Body>

        <SectionTitle>ОТЧЁТ ПО ДОМУ · 7 ДНЕЙ</SectionTitle>
        {report.map((r) => {
          const m = member(r.user_id)
          if (!m) return null
          const pct = Math.round(Number(r.share) * 100)
          return (
            <View key={r.user_id} style={s.report}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={m.display_name} color={m.color} />
                <Body weight="bold" style={{ flex: 1 }}>{m.display_name}{m.id === me ? ' (я)' : ''}</Body>
                <Pixel size={14} color={m.color}>{pct}%</Pixel>
              </View>
              <View style={{ height: 8, backgroundColor: colors.card2, marginTop: 10 }}>
                <View style={{ width: `${pct}%`, height: 8, backgroundColor: m.color }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                {([['✅', 'сделал', r.done], ['👁', 'заметил', r.noticed], ['🧠', 'спланировал', r.planned], ['📣', 'напомнил', r.reminded]] as const).map(([e, l, v]) => (
                  <View key={l} style={{ alignItems: 'center', flex: 1 }}>
                    <Body size={16} weight="bold">{e} {v}</Body>
                    <Body size={11} color={colors.dim}>{l}</Body>
                  </View>
                ))}
              </View>
            </View>
          )
        })}
        <Body size={12} color={colors.dim}>👁 🧠 📣 — невидимый труд. Его тоже считаем.</Body>

        <SectionTitle>ЗВЁЗДЫ ЗА НЕДЕЛЮ</SectionTitle>
        {ranked.map((m, i) => (
          <View key={m.id} style={s.row}>
            <Pixel size={10} color={i === 0 ? colors.gold : colors.dim} style={{ width: 28 }}>{i === 0 ? '👑' : `${i + 1}.`}</Pixel>
            <Avatar name={m.display_name} color={m.color} />
            <Body weight="medium" style={{ flex: 1 }}>{m.display_name}{m.id === me ? ' (я)' : ''}</Body>
            <View style={{ alignItems: 'flex-end' }}>
              <Pixel size={10} color={colors.gold}>⭐ {d.weekStars[m.id] ?? 0}</Pixel>
              <Body size={11} color={colors.dim}>всего {d.stars[m.id] ?? 0}</Body>
            </View>
          </View>
        ))}

        <SectionTitle>ТИТУЛЫ НЕДЕЛИ</SectionTitle>
        <View style={s.grid}>
          {titles.map((t) => (
            <View key={t.verb} style={[s.badge, t.holder && { borderColor: t.holder.color }]}>
              <Body size={26}>{t.icon}</Body>
              <Pixel size={7} color={t.holder ? colors.text : colors.dim} style={{ textAlign: 'center', marginTop: 6 }}>{t.name.toUpperCase()}</Pixel>
              <Body size={12} color={t.holder?.color ?? colors.dimmer} style={{ marginTop: 4 }}>{t.holder?.display_name ?? '—'}</Body>
            </View>
          ))}
        </View>

        <SectionTitle>ЛЕНТА</SectionTitle>
        {d.activity.filter((a) => describe(a, member)).slice(0, 30).map((a) => (
          <View key={a.id} style={s.feed}>
            <Body size={14} style={{ flex: 1 }}>
              <Body size={14} weight="bold" color={member(a.actor_id)?.color ?? colors.dim}>
                {member(a.actor_id)?.display_name ?? 'Дом'}
              </Body>{' '}{describe(a, member)}
              {a.stars ? <Body size={14} color={colors.gold}>{`  +${a.stars}⭐`}</Body> : null}
            </Body>
            <Body size={11} color={colors.dimmer}>{ago(a.created_at, d.now)}</Body>
            {a.actor_id && a.actor_id !== me && a.stars ? (
              <Pressable onPress={() => thanks(a)} hitSlop={8}><Body size={18}>🙏</Body></Pressable>
            ) : null}
          </View>
        ))}

        <SectionTitle>ПРИГЛАСИТЬ</SectionTitle>
        <View style={s.code}>
          <Pixel size={18} color={colors.green} glow>{household?.invite_code}</Pixel>
        </View>
        <Button title="ОТПРАВИТЬ КОД" onPress={invite} style={{ marginTop: 10 }} />
        <Button variant="ghost" small title="ВЫЙТИ" onPress={signOut} style={{ marginTop: 40, borderColor: colors.dimmer }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function describe(a: Activity, member: (id: string | null | undefined) => { display_name: string } | undefined): string | null {
  const x = a.data ?? {}
  switch (a.verb) {
    case 'task_done': return x.for && x.for !== a.actor_id
      ? `сделал(а) за ${member(x.for)?.display_name ?? 'другого'}: ${x.title}` : `сделал(а): ${x.title}`
    case 'task_created': return `дал(а) дело ${member(x.assignee)?.display_name ?? ''}: ${x.title}`
    case 'flag_raised': return `кинул(а) флаг: ${x.title}`
    case 'flag_claimed': return `взял(а) флаг: ${x.title}`
    case 'appliance_state': return `${x.name} → ${x.label}`
    case 'kick': return `${kickLevels[(x.level ?? 1) as 1 | 2 | 3 | 4].name.toLowerCase()} → ${member(x.to)?.display_name ?? ''}`
    case 'member_joined': return 'в доме!'
    case 'household_created': return 'создал(а) дом'
    default: return null
  }
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '48.5%', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, alignItems: 'center' },
  feed: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderColor: colors.border },
  report: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8 },
  code: { borderWidth: 2, borderColor: colors.green, borderStyle: 'dashed', padding: 18, alignItems: 'center' },
})

import { useCallback, useState } from 'react'
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useHouseData } from '@/lib/useHouseData'
import { ago } from '@/lib/heat'
import { kickLevels } from '@/lib/kicks'
import { colors } from '@/lib/theme'
import type { Activity, Member } from '@/lib/types'
import { Avatar, Body, Button, Chip, Input, Pixel, SectionTitle } from '@/components/ui'
import { Tutorial } from '@/components/Tutorial'

const TITLES = [
  { verb: 'flag_raised', name: 'Глаз-алмаз', icon: '👁', hint: 'больше всех заметил' },
  { verb: 'flag_claimed', name: 'Спасатель', icon: '🛟', hint: 'больше всех взял флагов' },
  { verb: 'appliance_state', name: 'Хозяин стирки', icon: '🧺', hint: 'больше всех крутил приборы' },
  { verb: 'kick', name: 'Главный пинатель', icon: '🥊', hint: 'больше всех пинал' },
]

export default function Family() {
  const { session, household, members, member, signOut } = useSession()
  const me = session?.user.id
  const d = useHouseData()
  const [editing, setEditing] = useState<Member | null>(null)
  const [help, setHelp] = useState(false)
  const iAmAdult = member(me)?.role !== 'child'

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

        <SectionTitle>ЛЮДИ</SectionTitle>
        {members.map((m) => (
          <Pressable key={m.id} onPress={() => (iAmAdult || m.id === me) && setEditing(m)}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
            <Avatar name={m.display_name} color={m.color} />
            <View style={{ flex: 1 }}>
              <Body weight="medium">{m.display_name}{m.id === me ? ' (я)' : ''}</Body>
              <Body size={12} color={colors.dim}>
                {m.role === 'child' ? 'ребёнок' : m.role === 'guest' ? 'гость' : 'взрослый'}
                {m.is_placeholder ? ' · ещё не в приложении' : ''}
              </Body>
            </View>
            {(iAmAdult || m.id === me) && <Body color={colors.dimmer}>✎</Body>}
          </Pressable>
        ))}
        {members.filter((m) => m.is_placeholder).some((p) => members.some((x) => !x.is_placeholder && x.id !== p.id
          && x.display_name.trim().toLowerCase() === p.display_name.trim().toLowerCase())) && (
          <Body size={12} color={colors.yellow} style={{ marginTop: 8 }}>
            Похоже, кто-то тут дважды. Нажми на того, кто «ещё не в приложении» → «Это тот же человек».
          </Body>
        )}

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
        <Button variant="ghost" small title="🎙 ДОПОЛНИТЬ ДИАГНОСТИКУ" style={{ marginTop: 12 }}
          onPress={() => router.push({ pathname: '/onboarding/voice', params: { mode: 'more' } })} />

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
        <Button title="ЛИЧНЫЕ ПРИГЛАШЕНИЯ" onPress={() => router.push('/onboarding/invite')} style={{ marginTop: 10 }} />
        <Body size={12} color={colors.dim} style={{ marginTop: 6 }}>
          Для тех, кого ты уже добавила, — их дела сразу будут у них. Общий код — для новых людей.
        </Body>
        <Button variant="ghost" small title="ОТПРАВИТЬ ОБЩИЙ КОД" onPress={invite} style={{ marginTop: 10 }} />
        <Button variant="ghost" small title="❓ КАК ПОЛЬЗОВАТЬСЯ" onPress={() => setHelp(true)} style={{ marginTop: 28 }} />
        <Button variant="ghost" small title="ВЫЙТИ" onPress={signOut} style={{ marginTop: 12, borderColor: colors.dimmer }} />
      </ScrollView>
      <PersonSheet m={editing} onClose={() => setEditing(null)} />
      <Tutorial visible={help} onDone={() => setHelp(false)} />
    </SafeAreaView>
  )
}

// Поправить человека: имя, взрослый/ребёнок, «это тот же человек», убрать из дома
function PersonSheet({ m, onClose }: { m: Member | null; onClose: () => void }) {
  const { session, household, members, member, reload } = useSession()
  const me = session?.user.id
  const iAmAdult = member(me)?.role !== 'child'
  const [name, setName] = useState('')
  const [role, setRole] = useState<Member['role']>('adult')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  if (m && shown !== m.id) { setShown(m.id); setName(m.display_name); setRole(m.role) }
  if (!m && shown) setShown(null)
  const real = members.filter((x) => !x.is_placeholder && x.id !== m?.id)

  const done = async (error: { message: string } | null) => {
    setBusy(false)
    if (error) return Alert.alert('Не получилось', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    await reload()
    onClose()
  }
  const save = async () => {
    if (!m || !household) return
    setBusy(true)
    const { error } = await supabase.rpc('update_person', {
      p_household: household.id, p_user: m.id,
      p_name: name.trim() !== m.display_name ? name.trim() : null,
      p_role: iAmAdult && role !== m.role ? role : null,
    })
    done(error)
  }
  const merge = (into: Member) => Alert.alert(
    `${m!.display_name} и ${into.display_name} — один человек?`,
    `Все дела, звёзды и история «${m!.display_name}» перейдут к ${into.display_name} (тот, кто в приложении). Второй исчезнет.`,
    [{ text: 'Отмена', style: 'cancel' }, { text: 'Да, склеить', onPress: async () => {
      setBusy(true)
      const { error } = await supabase.rpc('merge_person', { p_household: household!.id, p_placeholder: m!.id, p_into: into.id })
      done(error)
    } }])
  const remove = () => Alert.alert(`Убрать ${m!.display_name} из дома?`,
    'Его дела уйдут в архив. Звёзды и история останутся.',
    [{ text: 'Отмена', style: 'cancel' }, { text: 'Убрать', style: 'destructive', onPress: async () => {
      setBusy(true)
      const { error } = await supabase.rpc('remove_person', { p_household: household!.id, p_user: m!.id })
      done(error)
    } }])

  return (
    <Modal transparent visible={!!m} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          {m && <>
            <Pixel size={11} color={colors.green} style={{ marginBottom: 14 }}>{m.id === me ? 'ЭТО Я' : 'ЧЕЛОВЕК'}</Pixel>
            <Input label="Имя" value={name} onChangeText={setName} />
            {iAmAdult && (
              <View style={{ flexDirection: 'row', marginBottom: 14 }}>
                <Chip label="Взрослый" active={role === 'adult'} onPress={() => setRole('adult')} />
                <Chip label="Ребёнок" active={role === 'child'} onPress={() => setRole('child')} />
              </View>
            )}
            <Button title="СОХРАНИТЬ" onPress={save} loading={busy} />
            {m.is_placeholder && iAmAdult && real.length > 0 && <>
              <Body size={13} color={colors.dim} style={{ marginTop: 18, marginBottom: 8 }}>
                {m.display_name} уже зашёл(зашла) в приложение и появился(ась) второй раз? Склей:
              </Body>
              {real.map((x) => (
                <Button key={x.id} variant="ghost" small title={`ЭТО ТОТ ЖЕ, ЧТО ${x.display_name.toUpperCase()}${x.id === me ? ' (Я)' : ''}`}
                  onPress={() => merge(x)} style={{ marginBottom: 8 }} />
              ))}
            </>}
            {iAmAdult && m.id !== me && (
              <Button variant="ghost" small title="УБРАТЬ ИЗ ДОМА" onPress={remove}
                style={{ marginTop: 18, borderColor: colors.red }} />
            )}
          </>}
        </Pressable>
      </Pressable>
    </Modal>
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
    case 'stock_check': return x.level === 'plenty' ? `проверил(а): ${x.icon ?? ''} ${x.name} — много`
      : `заметил(а): ${x.icon ?? ''} ${x.name} — ${x.level === 'out' ? 'нет!' : 'мало'}`
    case 'stock_bought': return `купил(а): ${x.icon ?? ''} ${x.name}`
    case 'task_approved': return `принял(а) работу ${member(x.doer)?.display_name ?? ''}: ${x.title}`
    case 'task_rejected': return `вернул(а) ${member(x.doer)?.display_name ?? ''}: ${x.title}${x.note ? ` — «${x.note}»` : ''}`
    case 'shopping_asked': return `попросил(а) купить → ${(x.to ?? []).map((u: string) => member(u)?.display_name).filter(Boolean).join(', ')}`
    case 'guide_photo': return `обновил(а) фото в гиде: ${x.title}`
    case 'guide_created': return `написал(а) гид: ${x.title}`
    case 'member_joined': return 'в доме!'
    case 'person_merged': return 'убрал(а) двойника в семье'
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopWidth: 2, borderColor: colors.green, padding: 20, paddingBottom: 40 },
  code: { borderWidth: 2, borderColor: colors.green, borderStyle: 'dashed', padding: 18, alignItems: 'center' },
})

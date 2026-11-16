import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useSession } from '@/lib/session'
import { useHouseData } from '@/lib/useHouseData'
import { heatRank, occurrenceHeat } from '@/lib/heat'
import { colors } from '@/lib/theme'
import { DraftCard, OccurrenceCard } from '@/components/cards'
import { Body, Button, Chip, Empty, Pixel, SectionTitle } from '@/components/ui'

export default function Tasks() {
  const { session, members } = useSession()
  const me = session?.user.id
  const d = useHouseData()
  const [who, setWho] = useState<string>('me')

  const filterId = who === 'me' ? me : who === 'all' ? null : who
  const list = d.occurrences.filter((o) => !filterId || o.assignee_id === filterId)
  const open = list.filter((o) => o.status !== 'done')
    .sort((a, b) => heatRank[occurrenceHeat(a, d.now)] - heatRank[occurrenceHeat(b, d.now)])
  const done = list.filter((o) => o.status === 'done')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={d.reload} tintColor={colors.green} />}>
        <Pixel size={16} color="#fff" glow style={{ textShadowColor: colors.green, marginTop: 8 }}>ДЕЛА</Pixel>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 }}>
          <Chip label="Мои" active={who === 'me'} onPress={() => setWho('me')} />
          <Chip label="Все" active={who === 'all'} onPress={() => setWho('all')} />
          {members.filter((m) => m.id !== me).map((m) => (
            <Chip key={m.id} label={m.display_name} color={m.color} active={who === m.id} onPress={() => setWho(m.id)} />
          ))}
        </View>

        <SectionTitle>НЕ СДЕЛАНО · {open.length}</SectionTitle>
        {open.length ? open.map((o) => <OccurrenceCard key={o.id} o={o} now={d.now} />)
          : <Empty icon="🏆" text="Пусто. Можно отдыхать." />}

        {done.length > 0 && <>
          <SectionTitle>СДЕЛАНО СЕГОДНЯ · {done.length}</SectionTitle>
          {done.map((o) => <OccurrenceCard key={o.id} o={o} now={d.now} />)}
        </>}

        {d.drafts.length > 0 && <>
          <SectionTitle>📝 ЧЕРНОВИКИ · {d.drafts.length}</SectionTitle>
          <Body size={12} color={colors.dim} style={{ marginBottom: 10 }}>
            Видишь только ты. Нажми — поправь — «В дела». ✕ — это не дело.
          </Body>
          {d.drafts.map((t) => <DraftCard key={t.id} t={t} onChange={d.reload} />)}
        </>}

        <Button title="+ НОВОЕ ДЕЛО" onPress={() => router.push('/new-task')} style={{ marginTop: 24 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

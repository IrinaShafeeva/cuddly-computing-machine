import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useSession } from '@/lib/session'
import { useGuides } from '@/lib/useGuides'
import { ago } from '@/lib/heat'
import { colors } from '@/lib/theme'
import { Photo } from '@/components/Photo'
import { Body, Button, Empty, Pixel } from '@/components/ui'

const IDEAS = ['🧽 Губка для стола', '🧺 Как ставить чёрную стирку', '🗑 Куда какой мусор', '🍽 Как загружать посудомойку']

// Гид: инструкции с живыми фото — что, где лежит, как выглядит сейчас
export default function GuideTab() {
  const { member } = useSession()
  const { guides, reload } = useGuides()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.green} />}>
        <Pixel size={16} color="#fff" glow style={{ textShadowColor: colors.green, marginTop: 8 }}>ГИД</Pixel>
        <Body size={13} color={colors.dim} style={{ marginTop: 4, marginBottom: 14 }}>
          Как у нас всё устроено. Фото живые: поменялось — обнови, и все сразу видят новое.
        </Body>
        <Button title="+ НОВЫЙ ГИД" onPress={() => router.push('/new-guide')} style={{ marginBottom: 16 }} />
        {guides.map((g) => {
          const last = g.history[0]
          return (
            <Pressable key={g.id} onPress={() => router.push({ pathname: '/guide/[id]', params: { id: g.id } })}
              style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}>
              {g.item ? <Photo path={g.item.path} zoom={false} style={{ width: 72, height: 72 }} />
                : <View style={s.noPhoto}><Body size={30}>{g.icon ?? '📘'}</Body></View>}
              <View style={{ flex: 1 }}>
                <Body weight="bold">{g.icon ? `${g.icon} ` : ''}{g.title}</Body>
                {g.place ? <Body size={12} color={colors.dim} numberOfLines={1} style={{ marginTop: 3 }}>📍 {g.place}</Body> : null}
                <Body size={11} color={colors.dimmer} style={{ marginTop: 3 }}>
                  {last ? `📸 ${member(last.by_user)?.display_name ?? ''} · ${ago(last.created_at)}` : 'без фото'}
                  {g.steps.length ? ` · шагов: ${g.steps.length}` : ''}
                </Body>
              </View>
            </Pressable>
          )
        })}
        {!guides.length && <>
          <Empty icon="🗺" text="Гидов пока нет. Например:" />
          {IDEAS.map((i) => <Body key={i} color={colors.dim} style={{ textAlign: 'center', marginTop: 6 }}>{i}</Body>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  noPhoto: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card2 },
})

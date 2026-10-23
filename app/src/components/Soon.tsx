import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

// Заглушка для вкладок следующих этапов
export function Soon({ title, icon, points }: { title: string; icon: string; points: string[] }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16 }}>
        <Pixel size={16} color="#fff" glow style={{ textShadowColor: colors.green, marginTop: 8 }}>{title}</Pixel>
        <View style={{ alignItems: 'center', marginTop: 60 }}>
          <Body size={60}>{icon}</Body>
          <Pixel size={10} color={colors.yellow} style={{ marginTop: 20 }}>СКОРО · NEXT LEVEL</Pixel>
        </View>
        <View style={{ marginTop: 30, gap: 10 }}>
          {points.map((p) => <Body key={p} color={colors.dim}>▸ {p}</Body>)}
        </View>
      </View>
    </SafeAreaView>
  )
}

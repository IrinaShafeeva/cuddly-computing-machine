import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

const TOTAL = 8

// Каркас шага онбординга: прогресс-бар в пикселях, заголовок, контент, кнопки снизу
export function Step({ n, title, subtitle, children, footer }: {
  n: number; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 20, paddingTop: 12 }}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, backgroundColor: i < n ? colors.green : colors.card2 }} />
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <Pixel size={14} color={colors.green} glow style={{ marginTop: 10 }}>{title}</Pixel>
        {subtitle && <Body color={colors.dim} style={{ marginTop: 10, lineHeight: 21 }}>{subtitle}</Body>}
        <View style={{ marginTop: 20 }}>{children}</View>
      </ScrollView>
      {footer && <View style={{ padding: 20, paddingTop: 8, gap: 10 }}>{footer}</View>}
    </SafeAreaView>
  )
}

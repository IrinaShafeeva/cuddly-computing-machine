import { useEffect, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput,
  View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, fonts, heatColor, type Heat } from '@/lib/theme'

// Пиксельный шрифт — заголовки, цифры, комбо
export function Pixel({ children, size = 10, color = colors.text, glow, style }: {
  children: ReactNode; size?: number; color?: string; glow?: boolean; style?: StyleProp<TextStyle>
}) {
  return (
    <Text style={[{ fontFamily: fonts.pixel, fontSize: size, color, lineHeight: size * 1.6 },
      glow && { textShadowColor: color, textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }, style]}>
      {children}
    </Text>
  )
}

// Обычный читаемый текст
export function Body({ children, size = 15, color = colors.text, weight = 'regular', style, numberOfLines }: {
  children: ReactNode; size?: number; color?: string; weight?: 'regular' | 'medium' | 'bold'
  style?: StyleProp<TextStyle>; numberOfLines?: number
}) {
  const family = weight === 'bold' ? fonts.bodyBold : weight === 'medium' ? fonts.bodyMedium : fonts.body
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: family, fontSize: size, color }, style]}>{children}</Text>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.section}>
      <Pixel size={8} color={colors.dim} style={{ letterSpacing: 2 }}>{children}</Pixel>
      {right}
    </View>
  )
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, small, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'
  loading?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>
}) {
  const bg = variant === 'primary' ? colors.green : variant === 'danger' ? colors.red : 'transparent'
  const fg = variant === 'ghost' ? colors.green : '#000'
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress() }}
      style={({ pressed }) => [s.button, small && s.buttonSmall,
        { backgroundColor: bg, borderColor: variant === 'ghost' ? colors.green : bg },
        (pressed || disabled) && { opacity: 0.6 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Pixel size={small ? 8 : 10} color={fg}>{title}</Pixel>}
    </Pressable>
  )
}

export function Input(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props
  return (
    <View style={{ marginBottom: 14 }}>
      {label && <Pixel size={7} color={colors.dim} style={{ marginBottom: 8 }}>{label}</Pixel>}
      <TextInput placeholderTextColor={colors.dimmer} selectionColor={colors.green}
        style={[s.input, style]} {...rest} />
    </View>
  )
}

// Карточка с цветной полосой огня. red — дрожит, fire — дрожит сильнее и пульсирует
export function HeatCard({ heat, children, onPress, style }: {
  heat: Heat; children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>
}) {
  const shake = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (heat !== 'red' && heat !== 'fire') return
    const amp = heat === 'fire' ? 3 : 1.5
    const step = (v: number) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: true })
    const loop = Animated.loop(Animated.sequence([
      step(amp), step(-amp), step(amp), step(-amp), step(0),
      Animated.delay(heat === 'fire' ? 700 : 1800),
    ]))
    loop.start()
    let p: Animated.CompositeAnimation | undefined
    if (heat === 'fire') {
      p = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]))
      p.start()
    }
    return () => { loop.stop(); p?.stop() }
  }, [heat, shake, pulse])

  const c = heatColor[heat]
  const borderColor = heat === 'fire'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [colors.red, colors.fire] })
    : heat === 'green' ? colors.border : c

  return (
    <Animated.View style={[{ transform: [{ translateX: shake }] }, style]}>
      <Pressable onPress={onPress}>
        <Animated.View style={[s.card, { borderLeftColor: c, borderColor },
          heat === 'fire' && { backgroundColor: '#1d0d05' }, heat === 'red' && { backgroundColor: '#1a0c0c' }]}>
          {children}
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderColor: color }]}>
      <Pixel size={size * 0.36} color={color}>{name.slice(0, 1).toUpperCase()}</Pixel>
    </View>
  )
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 24 }}>
      <Text style={{ fontSize: 34, marginBottom: 10 }}>{icon}</Text>
      <Body color={colors.dim} size={14} style={{ textAlign: 'center' }}>{text}</Body>
    </View>
  )
}

export function Chip({ label, active, onPress, color = colors.green }: {
  label: string; active?: boolean; onPress: () => void; color?: string
}) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress() }}
      style={[s.chip, { borderColor: active ? color : colors.border }, active && { backgroundColor: colors.greenMid }]}>
      <Body size={13} weight="medium" color={active ? color : colors.dim}>{label}</Body>
    </Pressable>
  )
}

const s = StyleSheet.create({
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  button: { borderWidth: 2, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, color: colors.text,
    fontFamily: fonts.body, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12,
  },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderLeftWidth: 4, padding: 12, marginBottom: 8,
  },
  avatar: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card2 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 8 },
})

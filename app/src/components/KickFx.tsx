import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Dimensions, Easing, Modal, Pressable, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { kickLevels } from '@/lib/kicks'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

type L = 1 | 2 | 3 | 4
const { width: W, height: H } = Dimensions.get('window')

// Цвет вспышки и сила тряски по уровню
export const kickColor = (l: L) => (l === 4 ? '#7c4dff' : l === 3 ? colors.fire : l === 2 ? colors.yellow : colors.green)
const BANG = { 1: 'БАМ!', 2: 'БА-БАХ!', 3: 'ХРЯСЬ!!', 4: 'КА-БУМ!!!' } as const

// Вибрация: чем сильнее пинок, тем дольше и тяжелее
export function kickHaptics(l: L) {
  const style = l >= 2 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium
  const hits = [1, 3, 6, 12][l - 1]
  let n = 0
  const t = setInterval(() => {
    Haptics.impactAsync(style)
    if (++n >= hits) {
      clearInterval(t)
      if (l >= 3) Haptics.notificationAsync(l === 4 ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning)
    }
  }, l === 4 ? 70 : 100)
  return () => clearInterval(t)
}

// Сцена удара: перчатка влетает, вспышка, тряска, искры; на 4-м уровне — молнии
export function KickFx({ level, from = 'left', children }: { level: L; from?: 'left' | 'bottom'; children?: ReactNode }) {
  const fly = useRef(new Animated.Value(0)).current
  const flash = useRef(new Animated.Value(0)).current
  const shake = useRef(new Animated.Value(0)).current
  const burst = useRef(new Animated.Value(0)).current
  const bolts = useRef(new Animated.Value(0)).current
  const color = kickColor(level)

  useEffect(() => {
    fly.setValue(0); flash.setValue(0); shake.setValue(0); burst.setValue(0); bolts.setValue(0)
    const impactAt = 380
    Animated.timing(fly, { toValue: 1, duration: impactAt, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start()
    const amp = [5, 10, 16, 26][level - 1]
    const shakes = [4, 8, 14, 26][level - 1]
    const step = (v: number) => Animated.timing(shake, { toValue: v, duration: 35, useNativeDriver: true })
    Animated.sequence([
      Animated.delay(impactAt),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
        Animated.timing(burst, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.sequence(Array.from({ length: shakes }, (_, i) => step((i % 2 ? -1 : 1) * amp * (1 - i / shakes))).concat(step(0))),
      ]),
    ]).start()
    if (level === 4) {
      Animated.sequence([Animated.delay(impactAt), Animated.loop(Animated.sequence([
        Animated.timing(bolts, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(bolts, { toValue: 0.15, duration: 90, useNativeDriver: true }),
        Animated.timing(bolts, { toValue: 0.9, duration: 40, useNativeDriver: true }),
        Animated.timing(bolts, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]), { iterations: 4 })]).start()
    }
    const t = setTimeout(() => kickHaptics(level), impactAt)
    return () => clearTimeout(t)
  }, [level, fly, flash, shake, burst, bolts])

  const startX = from === 'left' ? -W * 0.8 : 0
  const startY = from === 'bottom' ? H * 0.6 : 40
  const sparks = level >= 2 ? (level === 4 ? 14 : level === 3 ? 10 : 6) : 0
  const spark = level === 4 ? '⭐' : level === 3 ? '💥' : '💨'

  return (
    <Animated.View style={[StyleSheet.absoluteFill, st.center, {
      transform: [{ translateX: shake }, { translateY: Animated.multiply(shake, level >= 3 ? 0.6 : 0) }],
    }]}>
      {/* молнии */}
      {level === 4 && BOLTS.map((b, i) => (
        <Animated.Text key={i} style={[st.bolt, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, fontSize: b.s,
          transform: [{ rotate: `${b.r}deg` }], opacity: bolts }]}>⚡</Animated.Text>
      ))}
      {/* искры разлетаются от точки удара */}
      {Array.from({ length: sparks }, (_, i) => {
        const a = (i / sparks) * Math.PI * 2
        const d = 90 + level * 30
        return (
          <Animated.Text key={i} style={[st.spark, {
            opacity: burst.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * d] }) },
              { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * d - 60] }) },
              { scale: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1.3, 0.8] }) },
            ],
          }]}>{spark}</Animated.Text>
        )
      })}
      {/* перчатка */}
      <Animated.Text style={[st.glove, {
        transform: [
          { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [startX, 0] }) },
          { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [startY, 0] }) },
          { rotate: fly.interpolate({ inputRange: [0, 1], outputRange: [level >= 3 ? '-720deg' : '-40deg', '0deg'] }) },
          { scale: Animated.add(fly.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1 + level * 0.2] }),
            burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] })) },
        ],
      }]}>🥊</Animated.Text>
      {/* БАМ! */}
      <Animated.View style={{ position: 'absolute', top: '50%', marginTop: -170, opacity: burst.interpolate({ inputRange: [0, 0.05, 0.9, 1], outputRange: [0, 1, 1, 0.9] }),
        transform: [{ scale: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [2.4, 1, 1.05] }) }, { rotate: '-8deg' }] }}>
        <Pixel size={14 + level * 4} color={color} glow>{BANG[level]}</Pixel>
      </Animated.View>
      {children ? <View style={{ position: 'absolute', top: '50%', marginTop: 60, left: 24, right: 24, alignItems: 'center' }}>{children}</View> : null}
      {/* вспышка */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        backgroundColor: level === 4 ? '#b388ff' : level >= 3 ? '#ff5252' : '#ffffff',
        opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, level === 1 ? 0.25 : 0.55] }),
      }]} />
    </Animated.View>
  )
}

const BOLTS = [
  { x: 0.05, y: 0.12, s: 70, r: -15 }, { x: 0.72, y: 0.08, s: 90, r: 20 }, { x: 0.8, y: 0.45, s: 60, r: 10 },
  { x: 0.02, y: 0.55, s: 80, r: -25 }, { x: 0.35, y: 0.78, s: 70, r: 15 }, { x: 0.65, y: 0.72, s: 85, r: -10 },
  { x: 0.4, y: 0.02, s: 55, r: 5 },
]

// Отправитель: «Пинок улетел» — короткая сцена на весь экран, закрывается сама
type Shot = { level: L; to: string; title: string } | null
let fire: ((s: Shot) => void) | null = null
export function showKickSent(s: NonNullable<Shot>) { fire?.(s) }

export function KickSentLayer() {
  const [shot, setShot] = useState<Shot>(null)
  const [key, setKey] = useState(0)
  useEffect(() => {
    fire = (s) => { setShot(s); setKey((k) => k + 1) }
    return () => { fire = null }
  }, [])
  useEffect(() => {
    if (!shot) return
    const t = setTimeout(() => setShot(null), [1300, 1600, 2000, 2600][shot.level - 1])
    return () => clearTimeout(t)
  }, [shot, key])
  if (!shot) return null
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => setShot(null)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,10,10,0.92)' }} onPress={() => setShot(null)}>
        <KickFx key={key} level={shot.level} from="bottom">
          <Pixel size={12} color={kickColor(shot.level)} style={{ textAlign: 'center' }}>{kickLevels[shot.level].name.toUpperCase()}</Pixel>
          <Body size={18} weight="bold" style={{ textAlign: 'center', marginTop: 12 }}>→ {shot.to}</Body>
          {!!shot.title && <Body size={14} color={colors.dim} style={{ textAlign: 'center', marginTop: 6 }}>{shot.title}</Body>}
          {shot.level < 4 && <Body size={12} color={colors.dimmer} style={{ textAlign: 'center', marginTop: 18 }}>
            Пни ещё раз — будет сильнее
          </Body>}
        </KickFx>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  glove: { fontSize: 110, position: 'absolute', top: '50%', marginTop: -75 },
  spark: { position: 'absolute', top: '50%', marginTop: -20, fontSize: 30 },
  bolt: { position: 'absolute' },
})

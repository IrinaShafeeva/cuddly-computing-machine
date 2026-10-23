import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { kickLevels, kickResponses, randomPhrase } from '@/lib/kicks'
import { colors } from '@/lib/theme'
import type { Kick } from '@/lib/types'
import { Body, Button, Pixel } from './ui'

// Полноэкранный входящий пинок: ботинок влетает, экран трясётся, телефон вибрирует
export function KickOverlay() {
  const { session, member } = useSession()
  const me = session?.user.id
  const [kick, setKick] = useState<Kick | null>(null)
  const [title, setTitle] = useState('')
  const [phrase, setPhrase] = useState('')
  const boot = useRef(new Animated.Value(0)).current
  const shake = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(`kicks:${me}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'kicks', filter: `to_user=eq.${me}` },
        async (payload) => {
          const k = payload.new as Kick
          let t = ''
          if (k.occurrence_id) {
            const { data } = await supabase.from('task_occurrences').select('task:tasks(title)')
              .eq('id', k.occurrence_id).maybeSingle()
            t = (data?.task as any)?.title ?? ''
          } else if (k.flag_id) {
            const { data } = await supabase.from('flags').select('title').eq('id', k.flag_id).maybeSingle()
            t = data?.title ?? ''
          }
          setTitle(t)
          setPhrase(k.phrase ?? randomPhrase(k.level))
          setKick(k)
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me])

  useEffect(() => {
    if (!kick) return
    boot.setValue(0)
    Animated.timing(boot, { toValue: 1, duration: 450, easing: Easing.out(Easing.back(2)), useNativeDriver: true }).start()
    const amp = 4 + kick.level * 3
    const step = (v: number) => Animated.timing(shake, { toValue: v, duration: 40, useNativeDriver: true })
    Animated.sequence([Animated.delay(380), ...Array.from({ length: 4 + kick.level * 2 }, (_, i) => step(i % 2 ? -amp : amp)), step(0)]).start()
    // Вибрация: чем выше уровень, тем больше ударов
    let n = 0
    const buzz = setInterval(() => {
      Haptics.impactAsync(kick.level >= 3 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium)
      if (++n >= kick.level * 2) clearInterval(buzz)
    }, 120)
    return () => clearInterval(buzz)
  }, [kick, boot, shake])

  const respond = async (r: string) => {
    if (kick) await supabase.rpc('respond_kick', { p_kick: kick.id, p_response: r })
    setKick(null)
  }

  if (!kick) return null
  const lvl = kickLevels[kick.level]
  const from = member(kick.from_user)
  const color = kick.level >= 3 ? colors.fire : kick.level === 2 ? colors.yellow : colors.green

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setKick(null)}>
      <Animated.View style={[st.wrap, { borderColor: color, transform: [{ translateX: shake }] }]}>
        <Animated.Text style={[st.boot, {
          transform: [
            { translateX: boot.interpolate({ inputRange: [0, 1], outputRange: [-400, 0] }) },
            { rotate: boot.interpolate({ inputRange: [0, 1], outputRange: ['-60deg', '0deg'] }) },
            { scale: 1 + kick.level * 0.15 },
          ],
        }]}>
          {lvl.emoji}
        </Animated.Text>
        <Pixel size={16} color={color} glow style={{ textAlign: 'center', marginTop: 16 }}>{lvl.name}</Pixel>
        {kick.combo > 1 && <Pixel size={10} color={colors.gold} style={{ marginTop: 10 }}>COMBO x{kick.combo}</Pixel>}
        <Body size={15} color={colors.dim} style={{ marginTop: 24 }}>
          {from ? `${from.display_name} пинает тебя` : 'Дом пинает тебя'}
        </Body>
        {!!title && <Body size={22} weight="bold" style={{ textAlign: 'center', marginTop: 8 }}>{title}</Body>}
        <Body size={16} color={colors.text} style={{ textAlign: 'center', marginTop: 14, fontStyle: 'italic' }}>
          «{phrase}»
        </Body>
        <View style={{ width: '100%', gap: 10, marginTop: 36 }}>
          {kickResponses.map((r, i) => (
            <Button key={r.key} title={r.label} variant={i === 0 ? 'primary' : 'ghost'} onPress={() => respond(r.key)} />
          ))}
        </View>
      </Animated.View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: {
    flex: 1, backgroundColor: 'rgba(10,10,10,0.97)', borderWidth: 4,
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  boot: { fontSize: 90 },
})

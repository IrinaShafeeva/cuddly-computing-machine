import { useEffect, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { kickLevels, kickResponses, randomPhrase } from '@/lib/kicks'
import { colors } from '@/lib/theme'
import type { Kick } from '@/lib/types'
import { Body, Button, Pixel } from './ui'
import { KickFx, kickColor } from './KickFx'

// Полноэкранный входящий пинок: перчатка влетает, вспышка, экран трясётся, телефон вибрирует
export function KickOverlay() {
  const { session, member } = useSession()
  const me = session?.user.id
  const [kick, setKick] = useState<Kick | null>(null)
  const [title, setTitle] = useState('')
  const [phrase, setPhrase] = useState('')

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

  const respond = async (r: string) => {
    if (kick) await supabase.rpc('respond_kick', { p_kick: kick.id, p_response: r })
    setKick(null)
  }

  if (!kick) return null
  const lvl = kickLevels[kick.level]
  const from = member(kick.from_user)
  const color = kickColor(kick.level)

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setKick(null)}>
      <View style={[st.wrap, { borderColor: color }]}>
        <View style={{ height: '48%', width: '100%' }}>
          <KickFx key={kick.id} level={kick.level} />
        </View>
        <Pixel size={16} color={color} glow style={{ textAlign: 'center' }}>{lvl.name}</Pixel>
        {kick.combo > 1 && <Pixel size={10} color={colors.gold} style={{ marginTop: 10 }}>COMBO x{kick.combo}</Pixel>}
        <Body size={15} color={colors.dim} style={{ marginTop: 18 }}>
          {from ? `${from.display_name} пинает тебя` : 'Дом пинает тебя'}
        </Body>
        {!!title && <Body size={22} weight="bold" style={{ textAlign: 'center', marginTop: 8 }}>{title}</Body>}
        <Body size={16} color={colors.text} style={{ textAlign: 'center', marginTop: 14, fontStyle: 'italic' }}>
          «{phrase}»
        </Body>
        <View style={{ width: '100%', gap: 10, marginTop: 28 }}>
          {kickResponses.map((r, i) => (
            <Button key={r.key} title={r.label} variant={i === 0 ? 'primary' : 'ghost'} onPress={() => respond(r.key)} />
          ))}
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  wrap: {
    flex: 1, backgroundColor: 'rgba(10,10,10,0.97)', borderWidth: 4,
    alignItems: 'center', justifyContent: 'center', padding: 28, overflow: 'hidden',
  },
})

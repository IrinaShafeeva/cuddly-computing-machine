import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Alert, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { ago } from '@/lib/heat'
import { LEVELS, PACKS, STOCK_ICONS, ZONES, type Level, type StockItem, type Zone } from '@/lib/stock'
import { colors } from '@/lib/theme'
import { Body, Button, Chip, Input, Pixel, SectionTitle } from '@/components/ui'

const levelColor = (l: Level | null) => (l === 'out' ? colors.red : l === 'low' ? colors.yellow : colors.green)

// «Наш холодильник»: полки с продуктами, у каждого своя подсветка. Нажал → много/мало/нет → звёзды
export default function Stock() {
  const { household, member } = useSession()
  const [items, setItems] = useState<StockItem[]>([])
  const [zone, setZone] = useState<Zone>('fridge')
  const [picked, setPicked] = useState<StockItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pop, setPop] = useState<string | null>(null)
  const popAnim = useRef(new Animated.Value(0)).current
  const chId = useId()

  const load = useCallback(async () => {
    if (!household) return
    const { data } = await supabase.from('stock_items')
      .select('id, name, icon, zone, level, on_shopping_list, last_checked_at, last_checked_by')
      .eq('household_id', household.id).order('sort').order('created_at')
    setItems((data ?? []) as StockItem[])
  }, [household])

  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => {
    if (!household) return
    const ch = supabase.channel(`stock:${household.id}:${chId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_items', filter: `household_id=eq.${household.id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [household, load, chId])

  const showPop = (text: string) => {
    setPop(text)
    popAnim.setValue(0)
    Animated.timing(popAnim, { toValue: 1, duration: 1500, useNativeDriver: true }).start(() => setPop(null))
  }

  const check = async (it: StockItem, level: Level) => {
    setPicked(null)
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, level, on_shopping_list: level !== 'plenty' } : x))
    const { data, error } = await supabase.rpc('check_stock', { p_item: it.id, p_level: level })
    if (error) { load(); return Alert.alert('Ошибка', error.message) }
    Haptics.notificationAsync(level === 'plenty' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    if (data) showPop(`+${data} ⭐ ${data > 1 ? 'ГЛАЗ-АЛМАЗ!' : 'ЗАМЕТИЛ!'}`)
  }

  const bought = async (it: StockItem) => {
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, level: 'plenty', on_shopping_list: false } : x))
    const { data, error } = await supabase.rpc('bought_stock', { p_item: it.id })
    if (error) { load(); return Alert.alert('Ошибка', error.message) }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (data) showPop(`+${data} ⭐ КУПЛЕНО!`)
  }

  const remove = (it: StockItem) => Alert.alert(`Убрать «${it.name}»?`, 'Продукт исчезнет с полки у всех.', [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Убрать', style: 'destructive', onPress: async () => {
      setPicked(null)
      const { error } = await supabase.rpc('delete_stock_item', { p_item: it.id })
      if (error) Alert.alert('Не получилось', error.message)
      load()
    } },
  ])

  const fillZone = async () => {
    const pack = PACKS[zone].map((p) => ({ ...p, zone }))
    const { error } = await supabase.rpc('add_stock_items', { p_household: household!.id, p_items: pack })
    if (error) return Alert.alert('Не получилось', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    load()
  }

  const inZone = items.filter((i) => i.zone === zone)
  const shopping = items.filter((i) => i.on_shopping_list)
    .sort((a, b) => (a.level === 'out' ? -1 : 0) - (b.level === 'out' ? -1 : 0))
  const z = ZONES.find((x) => x.key === zone)!
  // Полки по 4 продукта
  const shelves: StockItem[][] = []
  for (let k = 0; k < inZone.length; k += 4) shelves.push(inZone.slice(k, k + 4))
  // последняя полка заполнена — новая пустая полка под «+», иначе добавить некуда
  if (!shelves.length || shelves[shelves.length - 1].length === 4) shelves.push([])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.green} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Pixel size={16} color="#fff" glow style={{ textShadowColor: colors.green }}>ЗАПАСЫ</Pixel>
          {shopping.length > 0 && <Pixel size={9} color={colors.red}>🛒 {shopping.length}</Pixel>}
        </View>
        <Body size={13} color={colors.dim} style={{ marginTop: 4 }}>Нажми на продукт и скажи, сколько осталось. За внимательность — звёзды.</Body>

        {/* Зоны */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, marginHorizontal: -16 }}
          contentContainerStyle={{ paddingHorizontal: 16 }}>
          {ZONES.map((zz) => {
            const red = items.filter((i) => i.zone === zz.key && i.level === 'out').length
            return (
              <Chip key={zz.key} label={`${zz.icon} ${zz.label}${red ? ` · ${red}🔴` : ''}`} active={zone === zz.key} onPress={() => setZone(zz.key)} />
            )
          })}
        </ScrollView>

        {/* Пиксельный холодильник / шкаф */}
        <View style={s.fridge}>
          <View style={s.fridgeTop}>
            <Pixel size={9} color={colors.green}>{z.icon} {z.label.toUpperCase()}</Pixel>
            <View style={s.handle} />
          </View>
          {shelves.map((row, r) => (
            <View key={r} style={s.shelf}>
              {row.map((it) => {
                const c = levelColor(it.level)
                return (
                  <Pressable key={it.id} onPress={() => { Haptics.selectionAsync(); setPicked(it) }} onLongPress={() => remove(it)}
                    style={({ pressed }) => [s.item, { borderColor: c, shadowColor: c }, it.level === 'out' && s.itemOut,
                      pressed && { transform: [{ scale: 0.92 }] }]}>
                    <Body size={28}>{it.icon ?? '📦'}</Body>
                    <Body size={10} numberOfLines={1} color={colors.text} style={{ marginTop: 2 }}>{it.name}</Body>
                    <View style={[s.dot, { backgroundColor: c }]} />
                  </Pressable>
                )
              })}
              {row.length < 4 && r === shelves.length - 1 && (
                <Pressable onPress={() => setAdding(true)} style={[s.item, s.addTile]}>
                  <Pixel size={16} color={colors.dim}>+</Pixel>
                </Pressable>
              )}
            </View>
          ))}
        </View>
        {!inZone.length && PACKS[zone].length > 0 && (
          <Button variant="ghost" title={`ЗАПОЛНИТЬ: ${PACKS[zone].length} ТИПИЧНЫХ`} onPress={fillZone} style={{ marginTop: 12 }} />
        )}
        <Body size={11} color={colors.dimmer} style={{ marginTop: 8, textAlign: 'center' }}>Долгое нажатие — убрать продукт</Body>

        {/* Список покупок */}
        <SectionTitle right={items.some((i) => i.level === 'out' || i.level === 'low') ? (
          <Pressable onPress={() => setSharing(true)} hitSlop={8}><Pixel size={8} color={colors.green}>ОТПРАВИТЬ ↗</Pixel></Pressable>
        ) : undefined}>🛒 СПИСОК ПОКУПОК</SectionTitle>
        {shopping.length ? shopping.map((it) => (
          <View key={it.id} style={s.shopRow}>
            <Body size={22}>{it.icon ?? '📦'}</Body>
            <View style={{ flex: 1 }}>
              <Body weight="medium">{it.name}</Body>
              <Body size={12} color={levelColor(it.level)}>
                {it.level === 'out' ? 'нет совсем' : 'мало'}
                {it.last_checked_by ? ` · заметил(а) ${member(it.last_checked_by)?.display_name ?? ''}` : ''}
                {it.last_checked_at ? `, ${ago(it.last_checked_at)} назад` : ''}
              </Body>
            </View>
            <Button small title="КУПЛЕНО" onPress={() => bought(it)} />
          </View>
        )) : <Body color={colors.dim}>Всё есть. Пока 🙂</Body>}
      </ScrollView>

      {/* +звёзды */}
      {pop && (
        <Animated.View pointerEvents="none" style={[s.pop, {
          opacity: popAnim.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: popAnim.interpolate({ inputRange: [0, 1], outputRange: [20, -40] }) }],
        }]}>
          <Pixel size={14} color={colors.gold} glow>{pop}</Pixel>
        </Animated.View>
      )}

      {/* Сколько осталось? */}
      <Modal transparent visible={!!picked} animationType="fade" onRequestClose={() => setPicked(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicked(null)}>
          {picked && (
            <View style={s.sheet}>
              <View style={{ alignItems: 'center' }}>
                <Body size={56}>{picked.icon ?? '📦'}</Body>
                <Pixel size={12} color={colors.text} style={{ marginTop: 8 }}>{picked.name.toUpperCase()}</Pixel>
                <Body size={13} color={colors.dim} style={{ marginTop: 6 }}>
                  {picked.last_checked_at ? `проверяли ${ago(picked.last_checked_at)} назад` : 'ещё никто не проверял — +2 ⭐'}
                </Body>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
                {LEVELS.map((l) => (
                  <Pressable key={l.key} onPress={() => check(picked, l.key)}
                    style={[s.levelBtn, { borderColor: levelColor(l.key) }, picked.level === l.key && { backgroundColor: '#ffffff12' }]}>
                    <Pixel size={11} color={levelColor(l.key)}>{l.label.toUpperCase()}</Pixel>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </Pressable>
      </Modal>

      <AddItem visible={adding} zone={zone} onClose={() => { setAdding(false); load() }} />
      <ShareList visible={sharing} items={items} onClose={() => setSharing(false)} />
    </SafeAreaView>
  )
}

// Отправить список в мессенджер: выбираешь «нет совсем» / «мало» и разделы
function ShareList({ visible, items, onClose }: { visible: boolean; items: StockItem[]; onClose: () => void }) {
  const { household, session, members } = useSession()
  const others = members.filter((m) => m.id !== session?.user.id && !m.is_placeholder && m.role !== 'guest')
  const [to, setTo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [levels, setLevels] = useState<Level[]>(['out', 'low'])
  const [off, setOff] = useState<Zone[]>([])
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const candidates = items.filter((i) => i.level === 'out' || i.level === 'low')
  const zones = ZONES.filter((z) => candidates.some((i) => i.zone === z.key))
  const picked = candidates.filter((i) => levels.includes(i.level as Level) && !off.includes(i.zone))

  // В Пинок: короткий пуш «Ира просит купить: молоко, хлеб…» — нажал, и открылись Запасы
  const push = async () => {
    const out = picked.filter((i) => i.level === 'out').map((i) => i.name)
    const low = picked.filter((i) => i.level === 'low').map((i) => `${i.name} (мало)`)
    setBusy(true)
    const { error } = await supabase.rpc('ask_to_buy', { p_household: household!.id, p_to: to, p_text: [...out, ...low].join(', ') })
    setBusy(false)
    if (error) return Alert.alert('Не отправилось', error.message)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Отправлено 🛒', `${members.filter((m) => to.includes(m.id)).map((m) => m.display_name).join(', ')} получит пуш со списком`)
    onClose()
  }

  const send = async () => {
    const parts = zones.filter((z) => !off.includes(z.key)).map((z) => {
      const rows = picked.filter((i) => i.zone === z.key)
        .sort((a, b) => (a.level === 'out' ? 0 : 1) - (b.level === 'out' ? 0 : 1))
        .map((i) => `• ${i.name}${i.level === 'low' ? ' (мало)' : ''}`)
      return rows.length ? `${z.icon} ${z.label}\n${rows.join('\n')}` : null
    }).filter(Boolean)
    await Share.share({ message: `🛒 Купить${household ? ` · ${household.name}` : ''}\n\n${parts.join('\n\n')}\n\n— из Пинка 🥊` })
    onClose()
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Pixel size={11} color={colors.green} style={{ marginBottom: 14 }}>ОТПРАВИТЬ СПИСОК</Pixel>
          <Body size={13} color={colors.dim} style={{ marginBottom: 8 }}>Что берём?</Body>
          <View style={{ flexDirection: 'row', marginBottom: 14 }}>
            <Chip label={`🔴 Нет совсем · ${candidates.filter((i) => i.level === 'out').length}`} active={levels.includes('out')} color={colors.red}
              onPress={() => setLevels(toggle(levels, 'out'))} />
            <Chip label={`🟡 Мало · ${candidates.filter((i) => i.level === 'low').length}`} active={levels.includes('low')} color={colors.yellow}
              onPress={() => setLevels(toggle(levels, 'low'))} />
          </View>
          <Body size={13} color={colors.dim} style={{ marginBottom: 8 }}>Из каких разделов?</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 }}>
            {zones.map((z) => (
              <Chip key={z.key} label={`${z.icon} ${z.label}`} active={!off.includes(z.key)} onPress={() => setOff(toggle(off, z.key))} />
            ))}
          </View>
          {others.length > 0 && <>
            <Body size={13} color={colors.dim} style={{ marginBottom: 8 }}>Кому в Пинок (придёт пуш)?</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
              {others.map((m) => (
                <Chip key={m.id} label={m.display_name} color={m.color} active={to.includes(m.id)} onPress={() => setTo(toggle(to, m.id))} />
              ))}
            </View>
            <Button title={!picked.length ? 'НЕЧЕГО ОТПРАВЛЯТЬ' : to.length ? `🔔 В ПИНОК · ${picked.length}` : 'ВЫБЕРИ, КОМУ'}
              onPress={push} disabled={!picked.length || !to.length} loading={busy} />
          </>}
          <Button variant={others.length ? 'ghost' : 'primary'} title={picked.length ? `↗ В МЕССЕНДЖЕР · ${picked.length}` : 'НЕЧЕГО ОТПРАВЛЯТЬ'}
            onPress={send} disabled={!picked.length} style={{ marginTop: 10 }} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function AddItem({ visible, zone, onClose }: { visible: boolean; zone: Zone; onClose: () => void }) {
  const { household } = useSession()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📦')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('add_stock_items', { p_household: household!.id, p_items: [{ name: name.trim(), icon, zone }] })
    setBusy(false)
    if (error) return Alert.alert('Не получилось', error.message)
    if (data === 0) return Alert.alert('Уже есть', `«${name.trim()}» уже стоит на полке.`)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setName(''); setIcon('📦'); onClose()
  }
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Pixel size={11} color={colors.green} style={{ marginBottom: 14 }}>НОВЫЙ ПРОДУКТ</Pixel>
          <Input value={name} onChangeText={setName} placeholder="Например: Авокадо" autoFocus onSubmitEditing={save} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
            {STOCK_ICONS.map((e) => (
              <Pressable key={e} onPress={() => setIcon(e)} style={{ padding: 5, borderWidth: 1, borderColor: icon === e ? colors.green : 'transparent' }}>
                <Body size={22}>{e}</Body>
              </Pressable>
            ))}
          </View>
          <Button title="НА ПОЛКУ" onPress={save} disabled={!name.trim()} loading={busy} />
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  fridge: { marginTop: 14, borderWidth: 3, borderColor: '#cfd8dc', backgroundColor: '#11161a', padding: 8, paddingTop: 0 },
  fridgeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 3, borderColor: '#cfd8dc', marginBottom: 8, marginHorizontal: -8, paddingHorizontal: 10 },
  handle: { width: 34, height: 6, backgroundColor: '#cfd8dc' },
  shelf: { flexDirection: 'row', gap: 6, paddingBottom: 8, marginBottom: 8, borderBottomWidth: 2, borderColor: '#2b3a42', minHeight: 86 },
  item: { width: '23.5%', aspectRatio: 0.9, borderWidth: 2, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
    padding: 3, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  itemOut: { backgroundColor: '#2a0b0b' },
  addTile: { borderColor: colors.border, borderStyle: 'dashed', shadowOpacity: 0 },
  dot: { position: 'absolute', top: 4, right: 4, width: 7, height: 7 },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopWidth: 2, borderColor: colors.green, padding: 20, paddingBottom: 40 },
  levelBtn: { flex: 1, borderWidth: 2, paddingVertical: 18, alignItems: 'center' },
  pop: { position: 'absolute', alignSelf: 'center', top: '40%' },
})

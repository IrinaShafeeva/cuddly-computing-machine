import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

// Обучалка: карточки на весь экран, тап — следующая. Показываем один раз на телефоне.
const KEY = 'pinok.tutorial.v1'
export const tutorialSeen = () => { try { return !!localStorage.getItem(KEY) } catch { return true } }
const markSeen = () => { try { localStorage.setItem(KEY, '1') } catch {} }

type Card = { icon: string; title: string; text: string; how?: string; color: string }
const CARDS: Card[] = [
  { icon: '🥊', title: 'ЭТО ПИНОК', color: colors.green,
    text: 'Приложение, где домашние дела видно всем. Кто что делает, кто что заметил, кто про что помнит — и всё это честно делится.' },
  { icon: '✅', title: 'ДЕЛА', color: colors.green,
    text: 'Дело = что сделать, кто, когда и как напоминать. Можно один раз или по расписанию.',
    how: 'Зелёный «+» внизу на главной → «Дело». Сделал — нажми квадратик, получи ⭐' },
  { icon: '🥊', title: 'ПИНКИ', color: colors.fire,
    text: 'Пинок — это напоминание с характером. Приходят сами по расписанию дела, а можно пнуть вручную.',
    how: 'Держи перчатку 🥊 на чужом деле. Пнёшь подряд — сильнее: с разбега, с вертушки… до КОСМИЧЕСКОГО ⚡' },
  { icon: '👀', title: 'ПРОВЕРКА', color: colors.yellow,
    text: 'Не верится, что сделано? Включи у дела «Фото-отчёт» и «Я проверяю».',
    how: '«Сделано» придёт тебе с фото. «Принято ✅» — или «Не сделано ↩»: дело вернётся, звёзды заберём' },
  { icon: '🚩', title: 'ФЛАГИ', color: colors.red,
    text: 'Заметил, что надо что-то сделать, но не знаешь кому? Кинь флаг «кто возьмёт?».',
    how: 'Кто первый нажал «БЕРУ!» — тот и делает. Чем дольше флаг горел — тем больше звёзд' },
  { icon: '🧺', title: 'ПРИБОРЫ', color: colors.green,
    text: 'Стиралка, посудомойка, сушилка. Видно, что сейчас: моет, готово, надо разобрать.',
    how: 'Кнопка «→ …» — следующий статус. «Готово» — всем приходит флаг. Нажми на статус — поправить' },
  { icon: '🥫', title: 'ЗАПАСЫ', color: colors.yellow,
    text: 'Холодильник и шкафы. Отмечай, чего много, мало или нет — и список покупок соберётся сам.',
    how: '«ОТПРАВИТЬ ↗» у списка — уйдёт в Telegram или WhatsApp' },
  { icon: '🗺', title: 'ГИД', color: colors.green,
    text: 'Как у вас всё устроено: где лежит губка, как ставить стирку. С живыми фото.',
    how: 'Поменялось — нажми «📸 ОБНОВИТЬ ФОТО», и вся семья сразу видит, как теперь' },
  { icon: '👻', title: 'НЕВИДИМЫЙ ТРУД', color: '#b388ff',
    text: 'Заметить, спланировать, напомнить — это тоже работа. Пинок её считает.',
    how: 'Вкладка «Семья» → «Отчёт по дому»: сделал · заметил · спланировал · напомнил' },
  { icon: '⭐', title: 'ЗВЁЗДЫ', color: colors.gold,
    text: 'За всё хорошее — звёзды. Семья копит на общую цель недели, а у лидера — корона 👑.',
    how: 'Погнали! Обучалку можно открыть снова: «Семья» → «Как пользоваться»' },
]

export function Tutorial({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [i, setI] = useState(0)
  const pop = useRef(new Animated.Value(0)).current
  useEffect(() => { if (visible) setI(0) }, [visible])
  useEffect(() => {
    pop.setValue(0)
    Animated.timing(pop, { toValue: 1, duration: 450, easing: Easing.out(Easing.back(2)), useNativeDriver: true }).start()
  }, [i, visible, pop])

  const c = CARDS[i]
  const last = i === CARDS.length - 1
  const finish = () => { markSeen(); onDone() }
  const next = () => { Haptics.selectionAsync(); if (last) finish(); else setI(i + 1) }
  const back = () => { if (i > 0) { Haptics.selectionAsync(); setI(i - 1) } }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={finish}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={st.top}>
          <View style={{ flexDirection: 'row', gap: 4, flex: 1 }}>
            {CARDS.map((_, k) => <View key={k} style={[st.dot, { backgroundColor: k <= i ? c.color : colors.card2 }]} />)}
          </View>
          {!last && <Pressable onPress={finish} hitSlop={12}><Body size={13} color={colors.dim}>Пропустить</Body></Pressable>}
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* левая треть — назад, остальное — вперёд */}
          <Pressable style={{ width: '30%' }} onPress={back} />
          <Pressable style={{ flex: 1 }} onPress={next} />
        </View>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, st.center]}>
          <Animated.Text style={{ fontSize: 96, transform: [
            { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
            { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) },
          ] }}>{c.icon}</Animated.Text>
          <Animated.View style={{ opacity: pop, alignItems: 'center', paddingHorizontal: 28,
            transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }}>
            <Pixel size={18} color={c.color} glow style={{ marginTop: 24, textAlign: 'center' }}>{c.title}</Pixel>
            <Body size={18} style={{ textAlign: 'center', marginTop: 18, lineHeight: 26 }}>{c.text}</Body>
            {c.how && (
              <View style={[st.how, { borderColor: c.color }]}>
                <Body size={15} color={colors.text} style={{ textAlign: 'center', lineHeight: 22 }}>{c.how}</Body>
              </View>
            )}
          </Animated.View>
        </View>
        <View pointerEvents="none" style={st.bottom}>
          <Pixel size={9} color={last ? c.color : colors.dim}>{last ? 'НАЖМИ — И ПОЕХАЛИ 🥊' : `${i + 1} / ${CARDS.length} · НАЖМИ, ДАЛЬШЕ →`}</Pixel>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  dot: { flex: 1, height: 4 },
  center: { alignItems: 'center', justifyContent: 'center' },
  how: { marginTop: 22, borderWidth: 2, borderStyle: 'dashed', padding: 14, backgroundColor: colors.card },
  bottom: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
})

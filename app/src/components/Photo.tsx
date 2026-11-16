import { useState } from 'react'
import { ActivityIndicator, Dimensions, Image, Modal, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { usePhotoUrl } from '@/lib/photos'
import { colors } from '@/lib/theme'
import { Body, Pixel } from './ui'

const W = Dimensions.get('window').width

// Одно фото из хранилища (без нажатия)
function Img({ path, fit = 'cover' }: { path: string; fit?: 'cover' | 'contain' }) {
  const url = usePhotoUrl(path)
  return url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode={fit} />
    : <ActivityIndicator color={colors.dim} />
}

const box = { backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' as const,
  alignItems: 'center' as const, justifyContent: 'center' as const }

// Весь экран: листаешь пальцем, тап — закрыть
function Viewer({ paths, start, onClose }: { paths: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }} onPress={onClose}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          contentOffset={{ x: start * W, y: 0 }}
          onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / W))}
          style={{ flexGrow: 0, height: '80%' }}>
          {paths.map((p) => (
            <Pressable key={p} onPress={onClose} style={{ width: W, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <Img path={p} fit="contain" />
            </Pressable>
          ))}
        </ScrollView>
        {paths.length > 1 && <Body color={colors.dim} style={{ textAlign: 'center', marginTop: 12 }}>{i + 1} / {paths.length}</Body>}
      </Pressable>
    </Modal>
  )
}

// Фото из хранилища семьи; по нажатию — на весь экран
export function Photo({ path, style, zoom = true }: { path: string | null | undefined; style?: StyleProp<ViewStyle>; zoom?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!path) return null
  return (
    <>
      <Pressable disabled={!zoom} onPress={() => setOpen(true)} style={[box, style]}><Img path={path} /></Pressable>
      {open && <Viewer paths={[path]} start={0} onClose={() => setOpen(false)} />}
    </>
  )
}

// Обложка: первое фото и «+2», по нажатию — листать все
export function PhotoCover({ paths, style }: { paths: string[]; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false)
  if (!paths.length) return null
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[box, style]}>
        <Img path={paths[0]} />
        {paths.length > 1 && (
          <View style={{ position: 'absolute', right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4, paddingVertical: 2 }}>
            <Pixel size={7} color={colors.text}>+{paths.length - 1}</Pixel>
          </View>
        )}
      </Pressable>
      {open && <Viewer paths={paths} start={0} onClose={() => setOpen(false)} />}
    </>
  )
}

// Лента фото: листать вбок; onRemove — крестик на каждом (в редакторе)
export function PhotoStrip({ paths, size = 90, onRemove }: { paths: string[]; size?: number; onRemove?: (i: number) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!paths.length) return null
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {paths.map((p, i) => (
          <View key={p}>
            <Pressable onPress={() => setOpen(i)} style={[box, { width: size, height: size }]}><Img path={p} /></Pressable>
            {onRemove && (
              <Pressable onPress={() => onRemove(i)} hitSlop={8}
                style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.75)', width: 22, height: 22,
                  alignItems: 'center', justifyContent: 'center' }}>
                <Body size={12}>✕</Body>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      {open !== null && <Viewer paths={paths} start={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// Фото дела / отчёта: новый список, а если его нет (старые записи) — одно фото
export const taskPhotos = (t: { photo_paths?: string[]; photo_path?: string | null }) =>
  t.photo_paths?.length ? t.photo_paths : t.photo_path ? [t.photo_path] : []
export const proofPhotos = (o: { proof_paths?: string[]; proof_path?: string | null }) =>
  o.proof_paths?.length ? o.proof_paths : o.proof_path ? [o.proof_path] : []

import { useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { usePhotoUrl } from '@/lib/photos'
import { colors } from '@/lib/theme'

// Фото из хранилища семьи; по нажатию — на весь экран
export function Photo({ path, style, zoom = true }: { path: string | null | undefined; style?: StyleProp<ViewStyle>; zoom?: boolean }) {
  const url = usePhotoUrl(path)
  const [open, setOpen] = useState(false)
  if (!path) return null
  return (
    <>
      <Pressable disabled={!zoom || !url} onPress={() => setOpen(true)}
        style={[{ backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
          alignItems: 'center', justifyContent: 'center' }, style]}>
        {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          : <ActivityIndicator color={colors.dim} />}
      </Pressable>
      {zoom && url && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }} onPress={() => setOpen(false)}>
            <View style={{ width: '100%', height: '80%' }}>
              <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  )
}

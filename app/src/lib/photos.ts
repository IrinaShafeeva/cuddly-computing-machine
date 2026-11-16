import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { supabase } from './supabase'

// Фото семьи лежат в приватном бакете photos/<household_id>/<папка>/<файл>.jpg
// и показываются по временным ссылкам (час), которые кэшируем.

export async function pickPhoto(source: 'camera' | 'library'): Promise<string | null> {
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    Alert.alert('Нет доступа', source === 'camera' ? 'Разреши камеру в настройках телефона' : 'Разреши доступ к фото в настройках телефона')
    return null
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, allowsEditing: false }
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  return r.canceled ? null : r.assets[0]?.uri ?? null
}

// Спросить «Камера или галерея?» → выбрать → загрузить. Возвращает путь в хранилище или null.
export function askPhoto(householdId: string, folder: string, title = 'Фото'): Promise<string | null> {
  return new Promise((resolve) => {
    const go = async (src: 'camera' | 'library') => {
      const uri = await pickPhoto(src)
      if (!uri) return resolve(null)
      try { resolve(await uploadPhoto(householdId, uri, folder)) }
      catch (e) { Alert.alert('Не загрузилось', String((e as Error).message)); resolve(null) }
    }
    Alert.alert(title, undefined, [
      { text: '📷 Сфоткать', onPress: () => go('camera') },
      { text: '🖼 Из галереи', onPress: () => go('library') },
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) })
  })
}

export async function uploadPhoto(householdId: string, uri: string, folder: string): Promise<string> {
  const path = `${householdId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const body = await new File(uri).arrayBuffer()
  const { error } = await supabase.storage.from('photos').upload(path, body, { contentType: 'image/jpeg' })
  if (error) throw new Error(error.message)
  return path
}

const cache = new Map<string, { url: string; until: number }>()

export async function photoUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.until > Date.now()) return hit.url
  const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600)
  if (!data?.signedUrl) return null
  cache.set(path, { url: data.signedUrl, until: Date.now() + 3500_000 })
  return data.signedUrl
}

export function usePhotoUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(path ? cache.get(path)?.url ?? null : null)
  useEffect(() => {
    let alive = true
    if (!path) { setUrl(null); return }
    photoUrl(path).then((u) => alive && setUrl(u))
    return () => { alive = false }
  }, [path])
  return url
}

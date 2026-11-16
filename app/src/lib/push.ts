import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'

// Пока приложение открыто, пинок показывает KickOverlay — системный баннер для него не нужен
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const isKick = (n.request.content.data as any)?.type === 'kick'
    return { shouldShowBanner: !isKick, shouldShowList: true, shouldPlaySound: !isKick, shouldSetBadge: false }
  },
})

let currentToken: string | null = null

// Разрешение на уведомления + Expo push-токен → таблица devices
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    console.warn('Push: нет EAS projectId — выполни `npx eas-cli init`')
    return null
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('kicks', {
      name: 'Пинки', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 200, 100, 200, 100, 400],
    })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return null
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await supabase.rpc('register_device', { p_token: token, p_platform: Platform.OS })
    currentToken = token
    return token
  } catch (e) {
    console.warn('Push: не удалось получить токен', e)
    return null
  }
}

export async function unregisterPush() {
  if (currentToken) await supabase.rpc('unregister_device', { p_token: currentToken })
  currentToken = null
}

import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useFonts, PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p'
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter'
import { SessionProvider, useSession } from '@/lib/session'
import { KickOverlay } from '@/components/KickOverlay'
import { colors, fonts } from '@/lib/theme'

function Gate() {
  const { ready, session, household } = useSession()
  const segments = useSegments()
  const router = useRouter()

  // Без входа → sign-in; без семьи → onboarding; иначе → вкладки.
  // Из онбординга не выкидываем: после создания дома там ещё несколько шагов
  useEffect(() => {
    if (!ready) return
    const top = segments[0]
    if (!session) { if (top !== 'sign-in') router.replace('/sign-in') }
    else if (!household) { if (top !== 'onboarding') router.replace('/onboarding') }
    else if (top === 'sign-in') router.replace('/')
  }, [ready, session, household, segments, router])

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <ActivityIndicator color={colors.green} />
    </View>
  }
  return (
    <>
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.green,
        headerTitleStyle: { fontFamily: fonts.pixel, fontSize: 12 },
        contentStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="new-task" options={{ presentation: 'modal', title: 'НОВОЕ ДЕЛО' }} />
        <Stack.Screen name="new-flag" options={{ presentation: 'modal', title: 'НОВЫЙ ФЛАГ' }} />
        <Stack.Screen name="new-appliance" options={{ presentation: 'modal', title: 'ПРИБОР' }} />
      </Stack>
      {session && household && <KickOverlay />}
    </>
  )
}

export default function RootLayout() {
  const [loaded] = useFonts({ PressStart2P_400Regular, Inter_400Regular, Inter_500Medium, Inter_700Bold })
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Gate />
    </SessionProvider>
  )
}

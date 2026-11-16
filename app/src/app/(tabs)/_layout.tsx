import { useState } from 'react'
import { Text } from 'react-native'
import { Tabs } from 'expo-router'
import { colors, fonts } from '@/lib/theme'
import { Tutorial, tutorialSeen } from '@/components/Tutorial'

const icon = (e: string) => ({ focused }: { focused: boolean }) =>
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{e}</Text>

export default function TabsLayout() {
  // Первый запуск на этом телефоне — обучалка на весь экран
  const [tutorial, setTutorial] = useState(() => !tutorialSeen())
  return (
    <>
    <Tutorial visible={tutorial} onDone={() => setTutorial(false)} />
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
      tabBarActiveTintColor: colors.green,
      tabBarInactiveTintColor: colors.dim,
      tabBarLabelStyle: { fontFamily: fonts.pixel, fontSize: 7, marginTop: 4 },
      sceneStyle: { backgroundColor: colors.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'ДОМ', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="tasks" options={{ title: 'ДЕЛА', tabBarIcon: icon('✅') }} />
      <Tabs.Screen name="stock" options={{ title: 'ЗАПАСЫ', tabBarIcon: icon('🥫') }} />
      <Tabs.Screen name="guide" options={{ title: 'ГИД', tabBarIcon: icon('🗺') }} />
      <Tabs.Screen name="family" options={{ title: 'СЕМЬЯ', tabBarIcon: icon('👨‍👩‍👧') }} />
    </Tabs>
    </>
  )
}

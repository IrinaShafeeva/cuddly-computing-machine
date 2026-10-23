import { Stack } from 'expo-router'
import { WizardProvider } from '@/lib/wizard'
import { colors } from '@/lib/theme'

export default function OnboardingLayout() {
  return (
    <WizardProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
    </WizardProvider>
  )
}

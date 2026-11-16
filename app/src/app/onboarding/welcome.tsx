import { router } from 'expo-router'
import { Tutorial } from '@/components/Tutorial'

// Для приглашённого: сразу обучалка на весь экран, потом — к делам
export default function Welcome() {
  return <Tutorial visible onDone={() => router.replace('/')} />
}

import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { colors } from '@/lib/theme'
import { Body, Button, Input, Pixel } from '@/components/ui'

export default function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('up')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!email || !password || (mode === 'up' && !name)) return Alert.alert('Заполни все поля')
    setBusy(true)
    const { data, error } = mode === 'up'
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) return Alert.alert('Ошибка', error.message)
    if (mode === 'up' && !data.session) Alert.alert('Проверь почту', 'Мы отправили письмо для подтверждения.')
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }}>
          <Pixel size={34} color="#fff" glow style={{ textAlign: 'center', textShadowColor: colors.green }}>ПИНОК</Pixel>
          <Body color={colors.dim} style={{ textAlign: 'center', marginTop: 12, marginBottom: 40 }}>
            Дом держится на тех, кто замечает
          </Body>
          {mode === 'up' && <Input label="КАК ТЕБЯ ЗОВУТ" value={name} onChangeText={setName} placeholder="Ира" />}
          <Input label="EMAIL" value={email} onChangeText={setEmail} autoCapitalize="none"
            keyboardType="email-address" autoComplete="email" placeholder="you@mail.com" />
          <Input label="ПАРОЛЬ" value={password} onChangeText={setPassword} secureTextEntry
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'} placeholder="минимум 6 символов" />
          <Button title={mode === 'up' ? 'НАЧАТЬ' : 'ВОЙТИ'} onPress={submit} loading={busy} style={{ marginTop: 8 }} />
          <View style={{ marginTop: 18 }}>
            <Button variant="ghost" small
              title={mode === 'up' ? 'УЖЕ ЕСТЬ АККАУНТ' : 'СОЗДАТЬ АККАУНТ'}
              onPress={() => setMode(mode === 'up' ? 'in' : 'up')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

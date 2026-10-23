import { supabase } from './supabase'

const API = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '')

export const apiConfigured = !!API

// Запрос к серверу Пинка с токеном пользователя
export async function api<T>(path: string, body: FormData | object): Promise<T> {
  if (!API) throw new Error('Сервер Пинка ещё не подключён (EXPO_PUBLIC_API_URL)')
  const { data } = await supabase.auth.getSession()
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? (body as FormData) : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Ошибка сервера ${res.status}`)
  return json as T
}

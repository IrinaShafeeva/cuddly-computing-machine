import { supabase } from './supabase'

// Серверная часть — Supabase Edge Functions (supabase/functions/*)
const FUNCTIONS = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

export async function api<T>(fn: string, body: FormData | object): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(`${FUNCTIONS}/${fn}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${data.session?.access_token ?? KEY}`,
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? (body as FormData) : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error([json.error || `Ошибка сервера ${res.status}`, json.detail].filter(Boolean).join('\n\n'))
  return json as T
}

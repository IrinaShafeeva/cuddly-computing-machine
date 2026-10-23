import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { memberColors } from './theme'
import type { Household, Member, Profile } from './types'

type Ctx = {
  ready: boolean
  session: Session | null
  me: Profile | null
  household: Household | null
  members: Member[]
  member: (id: string | null | undefined) => Member | undefined
  reload: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Profile | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [members, setMembers] = useState<Member[]>([])

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null); setHousehold(null); setMembers([])
      return
    }
    const uid = s.user.id
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from('profiles').select('id, display_name, avatar').eq('id', uid).maybeSingle(),
      supabase.from('household_members').select('household_id, households(id, name, invite_code, timezone)')
        .eq('user_id', uid).order('joined_at').limit(1).maybeSingle(),
    ])
    setMe(profile ?? null)
    const hh = (membership?.households ?? null) as unknown as Household | null
    setHousehold(hh)
    if (hh) {
      const { data: rows } = await supabase.from('household_members')
        .select('role, color, joined_at, profiles(id, display_name, avatar)')
        .eq('household_id', hh.id).order('joined_at')
      setMembers((rows ?? []).map((r: any, i: number) => ({
        ...r.profiles, role: r.role, color: r.color ?? memberColors[i % memberColors.length],
      })))
    } else {
      setMembers([])
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await load(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const value: Ctx = {
    ready, session, me, household, members,
    member: (id) => members.find((m) => m.id === id),
    reload: () => load(session),
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}

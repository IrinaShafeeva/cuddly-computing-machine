export type Role = 'adult' | 'child' | 'guest'

export type Profile = { id: string; display_name: string; avatar: string | null }

export type Member = Profile & { role: Role; color: string; is_placeholder?: boolean }

export type Household = {
  id: string
  name: string
  invite_code: string
  timezone: string
}

export type Recurrence =
  | { type: 'once' }
  | { type: 'daily' }
  | { type: 'weekly'; days: number[] }
  | { type: 'every_n_days'; n: number }
  | { type: 'monthly'; day: number }

export type KickPlan = {
  base:
    | { type: 'times'; times: string[] }
    | { type: 'every'; minutes: number; between: [string, string] }
    | { type: 'before'; minutes: number }        // один раз — за N минут до срока
  escalation: (
    | { before: string; type: 'times'; times: string[] }
    | { before: string; type: 'every'; minutes: number; between: [string, string] }
  )[]
  overdue: 'keep_kicking' | 'notify_author'
  wake_up: boolean
}

export type Task = {
  id: string
  title: string
  icon: string | null
  notes: string | null
  created_by: string
  assignee_id: string
  recurrence: Recurrence
  kick_plan: KickPlan
  source: 'manual' | 'flag' | 'penalty' | 'object' | 'event' | 'onboarding'
  status?: 'draft' | 'active' | 'paused' | 'archived'
  photo_path?: string | null      // как должно выглядеть
  proof_photo?: boolean           // нужен фото-отчёт
  needs_review?: boolean          // автор проверяет
  guide_id?: string | null
}

export type Guide = {
  id: string
  title: string
  icon: string | null
  place: string | null
  steps: { text: string }[]
  created_by: string | null
  updated_at: string
}

export type GuidePhoto = { id: string; guide_id: string; kind: 'item' | 'place'; path: string; by_user: string | null; created_at: string }

export type Occurrence = {
  id: string
  task_id: string
  assignee_id: string
  due_at: string
  status: 'open' | 'done' | 'skipped' | 'missed'
  done_by: string | null
  done_at: string | null
  snoozed_until: string | null
  proof_path?: string | null
  review?: 'pending' | 'approved' | 'rejected' | null
  reviewed_by?: string | null
  review_note?: string | null
  task: Task
}

export type Flag = {
  id: string
  title: string
  kind: 'notice' | 'request'
  created_by: string | null
  due_at: string | null
  appliance_id: string | null
  status: 'open' | 'claimed' | 'done' | 'cancelled'
  claimed_by: string | null
  created_at: string
}

export type ApplianceState = {
  key: string
  label: string
  heat: 'green' | 'yellow' | 'red'
  flag?: string
}

export type Appliance = {
  id: string
  name: string
  kind: 'washer' | 'dryer' | 'dishwasher' | 'vacuum' | 'custom'
  icon: string | null
  states: ApplianceState[]
  state: string
  state_changed_at: string
  state_changed_by: string | null
}

export type Kick = {
  id: string
  occurrence_id: string | null
  flag_id: string | null
  from_user: string | null
  to_user: string
  level: 1 | 2 | 3 | 4
  combo: number
  phrase: string | null
  sent_at: string
  response: 'on_my_way' | 'in_10' | 'leave_me' | null
}

export type Activity = {
  id: string
  actor_id: string | null
  verb: string
  data: Record<string, any>
  stars: number | null
  created_at: string
}

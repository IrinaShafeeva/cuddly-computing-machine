const { supabase } = require('../db/supabase')

const PLANS = {
  free: {
    name: 'Бесплатно',
    price_eur: 0,
    max_members: 2,
    max_active_tasks: 10,
    voice_messages: 5,
    digest: true
  },
  family: {
    name: 'Семья',
    price_eur: 2.49,
    price_eur_annual: 1.99,
    max_members: 6,
    max_active_tasks: -1,
    voice_messages: -1,
    digest: true
  },
  family_plus: {
    name: 'Семья+',
    price_eur: 3.99,
    price_eur_annual: 3.19,
    max_members: 10,
    max_active_tasks: -1,
    voice_messages: -1,
    digest: true,
    priority_support: true
  }
}

function getEffectivePlan(family) {
  const now = new Date()
  if (family.trial_ends_at && new Date(family.trial_ends_at) > now) {
    return PLANS.family
  }
  if (family.subscription_ends_at && new Date(family.subscription_ends_at) > now) {
    return PLANS[family.plan] || PLANS.free
  }
  return PLANS[family.plan] || PLANS.free
}

async function checkMemberLimit(familyId) {
  if (!supabase) return { ok: true }
  const { data: family } = await supabase.from('families').select('*').eq('id', familyId).single()
  if (!family) return { ok: false }
  const { data: members } = await supabase.from('users').select('id').eq('family_id', familyId)
  const plan = getEffectivePlan(family)
  const limit = plan.max_members
  if (limit === -1) return { ok: true }
  if (members.length >= limit) {
    return { ok: false, family, plan, paywall: 'members' }
  }
  return { ok: true }
}

async function checkTaskLimit(familyId) {
  if (!supabase) return { ok: true }
  const { data: family } = await supabase.from('families').select('*').eq('id', familyId).single()
  if (!family) return { ok: false }
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id')
    .eq('family_id', familyId)
    .eq('is_active', true)
  const plan = getEffectivePlan(family)
  const limit = plan.max_active_tasks
  if (limit === -1) return { ok: true }
  if (tasks.length >= limit) {
    return { ok: false, family, plan, paywall: 'tasks' }
  }
  return { ok: true }
}

async function checkVoiceLimit(familyId) {
  if (!supabase) return { ok: true }
  const { data: family } = await supabase.from('families').select('*').eq('id', familyId).single()
  if (!family) return { ok: false }
  const plan = getEffectivePlan(family)
  const limit = plan.voice_messages
  if (limit === -1) return { ok: true }
  const used = family.voice_messages_used || 0
  if (used >= limit) {
    return { ok: false, family, plan, paywall: 'voice' }
  }
  return { ok: true }
}

async function incrementVoiceUsed(familyId) {
  if (!supabase) return
  const { data } = await supabase.from('families').select('voice_messages_used').eq('id', familyId).single()
  if (!data) return
  await supabase.from('families').update({ voice_messages_used: (data.voice_messages_used || 0) + 1 }).eq('id', familyId)
}

async function getTrialMessage(family) {
  const trialEnds = family.trial_ends_at ? new Date(family.trial_ends_at) : null
  if (!trialEnds) return null
  const daysLeft = Math.ceil((trialEnds - new Date()) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 3) {
    return 'Бесплатный период заканчивается через ' + daysLeft + ' дн. Оформи подписку чтобы не потерять задачи и настройки.'
  }
  return null
}

module.exports = {
  PLANS,
  getEffectivePlan,
  checkMemberLimit,
  checkTaskLimit,
  checkVoiceLimit,
  incrementVoiceUsed,
  getTrialMessage
}

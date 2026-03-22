const { supabase } = require('../db/supabase')

async function getUserWithFamily(ctx) {
  const tid = ctx.from?.id
  if (!tid || !supabase) return null
  const { data } = await supabase
    .from('users')
    .select('*, families(*)')
    .eq('telegram_id', tid)
    .single()
  return data
}

module.exports = { getUserWithFamily }

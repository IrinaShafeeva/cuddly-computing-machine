const { supabase } = require('../db/supabase')

function supabaseSession() {
  return async (ctx, next) => {
    const key = ctx.from?.id ? String(ctx.from.id) : null

    if (!key || !supabase) {
      ctx.session = ctx.session || {}
      return next()
    }

    try {
      const { data } = await supabase
        .from('sessions')
        .select('data')
        .eq('key', key)
        .single()
      ctx.session = data?.data || {}
    } catch {
      ctx.session = {}
    }

    await next()

    try {
      await supabase
        .from('sessions')
        .upsert(
          { key, data: ctx.session || {}, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
    } catch (e) {
      console.error('Session save error:', e)
    }
  }
}

module.exports = { supabaseSession }

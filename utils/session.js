const { supabase } = require('../db/supabase')

// In-memory fallback — keeps sessions alive even if Supabase write fails
const memoryCache = new Map()

function supabaseSession() {
  return async (ctx, next) => {
    const key = ctx.from?.id ? String(ctx.from.id) : null

    if (!key) {
      ctx.session = {}
      return next()
    }

    // Load from Supabase, fall back to memory cache
    if (supabase) {
      try {
        const { data } = await supabase
          .from('sessions')
          .select('data')
          .eq('key', key)
          .single()
        ctx.session = data?.data || memoryCache.get(key) || {}
      } catch {
        ctx.session = memoryCache.get(key) || {}
      }
    } else {
      ctx.session = memoryCache.get(key) || {}
    }

    await next()

    // Always save to memory cache first (instant, never fails)
    memoryCache.set(key, ctx.session || {})

    // Then try to persist to Supabase
    if (supabase) {
      try {
        await supabase
          .from('sessions')
          .upsert(
            { key, data: ctx.session || {}, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          )
      } catch (e) {
        console.error('Session save error (using memory fallback):', e.message)
      }
    }
  }
}

module.exports = { supabaseSession }

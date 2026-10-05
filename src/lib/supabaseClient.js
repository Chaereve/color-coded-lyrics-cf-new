import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env?.VITE_SUPABASE_URL
const KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(URL && KEY && URL.startsWith('http'))
export const supabase = hasSupabase ? createClient(URL, KEY) : null

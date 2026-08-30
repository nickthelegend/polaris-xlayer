import { createClient } from '@supabase/supabase-js'
import { Database } from './db_types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

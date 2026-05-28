import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Re-export canonical types from the shared types module so that existing
// imports of Fund from "@/lib/supabase" continue to work without changes.
export type { Fund, ScreenerFilters } from "@/lib/types";

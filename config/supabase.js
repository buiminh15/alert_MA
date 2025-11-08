const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong .env');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;
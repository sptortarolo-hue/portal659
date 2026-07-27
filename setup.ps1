# conectaMOS v2 - Setup Script
# Run this after creating your Supabase project and applying the migration

# 1. Set Supabase environment variables
$env:NEXT_PUBLIC_SUPABASE_URL = "https://sthumnpqhynybyxrnznp.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_32FmyVDn4oMdQgNvLnl-Ow_iTpuTKeo"
$env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_EfTByTLakzb3Cli0jvIxhg_KPRi_cbK"

# 2. Install dependencies (if not done already)
npm install

# 3. Run the app locally
npm run dev

# === SUPABASE SETUP (do this first) ===
# 1. Go to https://supabase.com/dashboard
# 2. Create project "conecta-mos"
# 3. Go to SQL Editor -> New query
# 4. Paste everything from: supabase/migrations/001_init.sql
# 5. Click Run

# === RENDER DEPLOY (do this second) ===
# 1. Go to https://render.com/dash
# 2. New -> Web Service
# 3. Connect repo: sptortarolo-hue/conectaMOS-v2
# 4. Plan: Hobby (free)
# 5. Build Command: npm run build
# 6. Start Command: npm run start
# 7. Add these Environment Variables:
#    NEXT_PUBLIC_SUPABASE_URL = https://sthumnpqhynybyxrnznp.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY = sb_publishable_32FmyVDn4oMdQgNvLnl-Ow_iTpuTKeo
#    SUPABASE_SERVICE_ROLE_KEY = sb_secret_EfTByTLakzb3Cli0jvIxhg_KPRi_cbK
# 8. Click "Create Web Service"
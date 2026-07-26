
from main import settings

print("Testing settings load:")
print("SUPABASE_URL loaded:", settings.SUPABASE_URL is not None)
print("SUPABASE_SERVICE_ROLE_KEY loaded:", settings.SUPABASE_SERVICE_ROLE_KEY is not None)
if settings.SUPABASE_SERVICE_ROLE_KEY:
    print("First 20 chars of service role key:", settings.SUPABASE_SERVICE_ROLE_KEY[:20], "...")

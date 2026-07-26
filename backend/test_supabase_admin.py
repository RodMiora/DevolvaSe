
import sys
from main import supabase_admin

log_file = open("test_supabase_log.txt", "w", encoding="utf-8")
sys.stdout = log_file
sys.stderr = log_file

print("Testing Supabase Admin test:")
try:
    result = supabase_admin.table('lessons').select('*').limit(1).execute()
    print("Successfully accessed lessons table:", result)
except Exception as e:
    print("Error accessing lessons table:", type(e))
    print("Exception:", str(e))
    import traceback
    print(traceback.format_exc())
log_file.close()
print("Test completed, check test_supabase_log.txt!")

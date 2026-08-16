import os, sys, importlib.util, py_compile

sys.path.insert(0, os.getcwd())

py_compile.compile('main.py', doraise=True)
print('SYNTAX_OK=True')

for k in ['PORT','HOST','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','DATABASE_URL','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_STREAM_WEBHOOK_SECRET','ADMIN_SECRET_KEY']:
    os.environ.setdefault(k, 'dummy')

spec = importlib.util.spec_from_file_location('main_mod', 'main.py')
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
    print('IMPORT_OK=True')
except Exception as e:
    print(f'IMPORT_FAILED: {type(e).__name__}: {str(e)[:200]}')
    sys.exit(1)

checks = {}
checks['has_enroll_model'] = hasattr(mod, 'EnrollmentUpsertRequest')
checks['has_note_create_model'] = hasattr(mod, 'InstructorNoteCreateRequest')
checks['has_note_update_model'] = hasattr(mod, 'InstructorNoteUpdateRequest')
checks['has_retry_wrapper'] = hasattr(mod, 'execute_supabase_with_retry')
checks['has_relation_missing_helper'] = hasattr(mod, '_is_table_or_relation_missing_error')

routes = [getattr(r, 'path', '') for r in getattr(mod.app, 'routes', [])]
checks['route_get_enroll'] = any('/admin/enrollments' in r and '{student_id}' in r for r in routes)
checks['route_post_enroll'] = '/admin/enrollments' in routes
checks['route_get_notes'] = any('/admin/notes' in r and '{student_id}' in r for r in routes)
checks['route_post_notes'] = '/admin/notes' in routes
checks['route_patch_notes'] = any('/admin/notes/' in r and '{note_id}' in r for r in routes)
checks['route_delete_notes'] = any('/admin/notes/' in r and '{note_id}' in r for r in routes)
checks['core_toggle_lock_intact'] = any('/admin/students/toggle-lock' in r for r in routes)
checks['core_approve_intact'] = any('/admin/lessons/approve' in r or '/admin/lessons/reject' in r for r in routes)

for k, v in checks.items():
    print(f'{k}={v}')

all_ok = all(checks.values())
print(f'ALL_CHECKS={all_ok}')
sys.exit(0 if all_ok else 1)

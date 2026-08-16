import os, sys
os.environ["R2_ACCESS_KEY_ID"] = "x"
os.environ["R2_SECRET_ACCESS_KEY"] = "x"
os.environ["R2_BUCKET_NAME"] = "x"
os.environ["R2_ENDPOINT_URL"] = "https://x.r2.cloudflarestorage.com"
os.environ["R2_PUBLIC_URL"] = "https://x.r2.dev"
os.environ["SUPABASE_URL"] = "https://x.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "x"
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
try:
    import py_compile
    py_compile.compile("main.py", doraise=True)
    import main  # noqa: F401
    checks = [
        ("IMPORT_OK", True),
        ("models_enroll", hasattr(main, "EnrollmentUpsertRequest")),
        ("models_note", hasattr(main, "InstructorNoteCreateRequest") and hasattr(main, "InstructorNoteUpdateRequest")),
        ("fn_table_missing", hasattr(main, "_is_table_or_relation_missing_error")),
        ("ep_get_enroll", "get_enrollment" in dir(main)),
        ("ep_upsert_enroll", "upsert_enrollment" in dir(main)),
        ("ep_list_notes", "list_instructor_notes" in dir(main)),
        ("ep_create_note", "create_instructor_note" in dir(main)),
        ("ep_update_note", "update_instructor_note" in dir(main)),
        ("ep_delete_note", "delete_instructor_note" in dir(main)),
        ("retry_fn", hasattr(main, "execute_supabase_with_retry")),
        ("status_wrapper", hasattr(main, "_upsert_student_lessons_status_safely")),
        ("toggle_fn", "toggle_lesson_lock" in dir(main)),
    ]
    lines = []
    for k, v in checks:
        lines.append(f"{k}={v}")
    open("_out3.txt", "w").write("\n".join(lines))
    sys.exit(0)
except Exception as e:
    with open("_out3.txt", "w") as f:
        f.write("FAIL: " + type(e).__name__ + " " + str(e)[:800] + "\n")
        import traceback
        traceback.print_exc(file=f)
    sys.exit(1)

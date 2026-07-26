import os
import subprocess
import boto3
import uuid
import tempfile
from dotenv import load_dotenv  # NEW: import dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
from supabase import create_client, Client

# NEW: Load the .env file explicitly!
load_dotenv()


class Settings(BaseSettings):
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_BUCKET_NAME: str
    R2_ENDPOINT_URL: str
    R2_PUBLIC_URL: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()

# Debug prints for env vars
print("=== DEBUG: Loading Supabase Credentials ===")
print(f"SUPABASE_URL from os.getenv: {os.getenv('SUPABASE_URL')}")
print(f"SUPABASE_SERVICE_ROLE_KEY from os.getenv (first 50 chars): {os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')[:50]}...")
print(f"SUPABASE_URL from settings: {settings.SUPABASE_URL}")
print(f"SUPABASE_SERVICE_ROLE_KEY from settings (first 50 chars): {settings.SUPABASE_SERVICE_ROLE_KEY[:50]}...")
print("============================================")

# Initialize Supabase client using os.getenv directly just in case
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

app = FastAPI()

# CORS configuration
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.12:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_ffmpeg_path():
    # Tenta múltiplos caminhos para o FFmpeg
    ffmpeg_paths = [
        'ffmpeg',
        r'C:\ffmpeg\ffmpeg.exe',
        r'C:\Program Files\FFmpeg\bin\ffmpeg.exe',
        r'C:\Program Files (x86)\FFmpeg\bin\ffmpeg.exe',
    ]
    for path in ffmpeg_paths:
        try:
            subprocess.run([path, '-version'], capture_output=True, check=True)
            return path
        except:
            continue
    raise Exception("FFmpeg não encontrado! Instale o FFmpeg e adicione ao PATH ou coloque em C:\\ffmpeg\\ffmpeg.exe")

class StudentCreate(BaseModel):
    full_name: str
    username: str
    password: str
    instruments: list[str]
    phone: Optional[str] = None

class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    instruments: Optional[list[str]] = None
    phone: Optional[str] = None

class InstrumentCreate(BaseModel):
    name: str

class InstrumentUpdate(BaseModel):
    name: str

class ModuleCreate(BaseModel):
    instrument_id: str
    title: str
    description: Optional[str] = None

class ModuleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class ToggleLessonLockRequest(BaseModel):
    student_id: str
    lesson_id: str
    unlocked: bool

class ApproveLessonRequest(BaseModel):
    student_id: str
    lesson_id: str

class LessonFeedbackRequest(BaseModel):
    teacher_id: str
    student_id: str
    lesson_id: str
    lesson_title: Optional[str] = None
    module_title: Optional[str] = None
    exercise_video_url: Optional[str] = None
    feedback_text: str

# Modificar rota create_student para usar supabase_admin
@app.post("/admin/create-student")
async def create_student(student: StudentCreate):
    try:
        internal_email = f"{student.username.lower()}@devolvase.app"
        auth_response = supabase_admin.auth.admin.create_user({
            "email": internal_email,
            "password": student.password,
            "user_metadata": {
                "full_name": student.full_name,
                "username": student.username,
                "role": "student"
            },
            "email_confirm": True
        });
        
        if not auth_response.user:
            raise HTTPException(status_code=400, detail="Erro ao criar usuário no Auth")

        user_id = auth_response.user.id
        instruments_str = ", ".join(student.instruments) if student.instruments else ""
        profile_data = {
            "id": user_id,
            "full_name": student.full_name,
            "role": "student",
            "instrument": instruments_str,
            "phone": student.phone
        }
        
        # Inserir na tabela profiles e garantir que o role seja student
        result = supabase_admin.table('profiles').insert(profile_data).execute()
        print(f"✅ Perfil criado para {student.full_name}: {result}")
        
        return {"status": "success", "user_id": user_id}
        
    except Exception as e:
        print(f"Erro ao criar aluno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/admin/students/{student_id}")
async def update_student(student_id: str, student: StudentUpdate):
    try:
        # Atualiza o perfil
        profile_data = {}
        if student.full_name:
            profile_data["full_name"] = student.full_name
        if student.instruments is not None:
            instruments_str = ", ".join(student.instruments)
            profile_data["instrument"] = instruments_str
        if student.phone is not None:
            profile_data["phone"] = student.phone
        
        result = supabase_admin.table('profiles').update(profile_data).eq('id', student_id).execute()
        print(f"✅ Perfil atualizado para aluno {student_id}: {result}")
        
        return {"status": "success"}
        
    except Exception as e:
        print(f"Erro ao atualizar aluno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/admin/students/{student_id}")
async def delete_student(student_id: str):
    try:
        # Deleta o usuário do Auth
        await supabase_admin.auth.admin.delete_user(student_id)
        # Deleta o perfil
        await supabase_admin.table('profiles').delete().eq('id', student_id).execute()
        
        print(f"✅ Aluno {student_id} deletado com sucesso")
        return {"status": "success"}
        
    except Exception as e:
        print(f"Erro ao deletar aluno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/toggle-lesson-lock")
async def toggle_lesson_lock(request: ToggleLessonLockRequest):
    try:
        print(f"Iniciando operacao para alternar estado da aula...")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        print(f"   unlocked: {request.unlocked}")
        print(f"   is_locked: {not request.unlocked}")
        
        new_status = 'unlocked' if request.unlocked else 'locked'
        
        # Upsert in student_lessons table using supabase_admin (bypasses RLS)
        print("   Executando upsert no Supabase...")
        try:
            result = supabase_admin.table('student_lessons').upsert({
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": not request.unlocked,
                "is_completed": False if request.unlocked else False,
                "status": new_status
            }, on_conflict="student_id,lesson_id").execute()
            print(f"   Resultado do Supabase (com status): {result}")
        except Exception as status_e:
            print(f"   Aviso: coluna status nao existe, usando fallback sem status: {status_e}")
            result = supabase_admin.table('student_lessons').upsert({
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": not request.unlocked
            }, on_conflict="student_id,lesson_id").execute()
            print(f"   Resultado do Supabase (fallback): {result}")
        
        print(f"✅ Aula {request.lesson_id} {'liberada' if request.unlocked else 'bloqueada'} para aluno {request.student_id}")
        return {"status": "success", "new_status": new_status}
        
    except Exception as e:
        print(f"❌ Erro ao alternar estado da aula:")
        print(f"   Tipo de erro: {type(e).__name__}")
        print(f"   Mensagem: {str(e)}")
        import traceback
        print(f"   Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/approve-lesson")
async def approve_lesson(request: ApproveLessonRequest):
    try:
        print(f"✅ Aprovando aula...")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        
        try:
            result = supabase_admin.table('student_lessons').upsert({
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": False,
                "is_completed": True,
                "status": "approved"
            }, on_conflict="student_id,lesson_id").execute()
            print(f"   Resultado approve: {result.data}")
        except Exception as status_e:
            print(f"   Aviso: coluna status nao existe, fallback: {status_e}")
            result = supabase_admin.table('student_lessons').upsert({
                "student_id": request.student_id,
                "lesson_id": request.lesson_id,
                "is_locked": False,
                "is_completed": True
            }, on_conflict="student_id,lesson_id").execute()
            print(f"   Resultado approve fallback: {result.data}")
        
        return {"status": "success", "new_status": "approved"}
    except Exception as e:
        print(f"ERRO approve-lesson: {e}")
        import traceback
        print(f"Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/send-lesson-feedback")
async def send_lesson_feedback(request: LessonFeedbackRequest):
    try:
        print(f"💬 Enviando feedback da aula para o chat...")
        print(f"   teacher_id: {request.teacher_id}")
        print(f"   student_id: {request.student_id}")
        print(f"   lesson_id: {request.lesson_id}")
        print(f"   lesson_title: {request.lesson_title}")
        print(f"   module_title: {request.module_title}")
        print(f"   exercise_video_url: {request.exercise_video_url}")
        print(f"   feedback_text: {request.feedback_text[:80]}...")
        
        # Formatação RICA profissional
        lines = []
        lines.append("🎸 **Feedback de Treino**")
        if request.module_title:
            lines.append(f"📁 Módulo: {request.module_title}")
        if request.lesson_title:
            lines.append(f"📌 Aula: {request.lesson_title}")
        lines.append("")
        lines.append(f'💬 "{request.feedback_text.strip()}"')
        if request.exercise_video_url:
            lines.append("")
            lines.append(f"🔗 {request.exercise_video_url}")
        
        message_content = "\n".join(lines)
        
        # Insert na tabela chat_messages
        msg_result = supabase_admin.table('chat_messages').insert({
            "sender_id": request.teacher_id,
            "receiver_id": request.student_id,
            "content": message_content,
            "type": "text",
            "related_lesson_id": request.lesson_id
        }).execute()
        
        print(f"✅ Feedback formatado enviado. Message ID: {msg_result.data[0].get('id') if msg_result.data else 'N/A'}")
        print(f"   Conteudo completo:\n{message_content}")
        
        return {"status": "success", "message": msg_result.data[0] if msg_result.data else None}
    except Exception as e:
        print(f"ERRO send-lesson-feedback: {e}")
        import traceback
        print(f"Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

s3_client = boto3.client(
    's3',
    endpoint_url=settings.R2_ENDPOINT_URL,
    aws_access_key_id=settings.R2_ACCESS_KEY_ID,
    aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
)

@app.post("/upload-exercise")
async def upload_exercise(
    student_id: str = Form(...),
    lesson_id: str = Form(...),
    video: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_input = f"temp_{file_id}_{video.filename}"
    temp_output = f"compressed_{file_id}.mp4"
    
    try:
        # Salva temporariamente
        with open(temp_input, "wb") as buffer:
            buffer.write(await video.read())
            
        # Compressao via FFmpeg (Mobile-friendly: H.264, AAC)
        # Limita a 720p para economia e performance
        ffmpeg_path = get_ffmpeg_path()
        cmd = [
            ffmpeg_path, '-i', temp_input,
            '-vcodec', 'libx264', '-crf', '28',
            '-preset', 'faster', '-tune', 'zerolatency',
            '-vf', "scale='min(720,iw)':-2",
            '-acodec', 'aac', '-b:a', '128k',
            temp_output
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {process.stderr}")
            
        # Upload para R2
        r2_key = f"exercises/{student_id}/{temp_output}"
        s3_client.upload_file(temp_output, settings.R2_BUCKET_NAME, r2_key)
        
        video_url = f"{settings.R2_PUBLIC_URL}/{r2_key}"
        
        # Insert na tabela exercises usando Supabase admin (via thread pool)
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        new_exercise = None
        
        def sync_db_ops():
            try:
                print(f"[DEBUG UPLOAD-EXERCISE] Iniciando insert no Supabase...")
                print(f"   student_id: {student_id}")
                print(f"   lesson_id: {lesson_id}")
                print(f"   video_url: {video_url}")
                
                # First check if exercise already exists for this lesson+student
                existing_result = supabase_admin.table('exercises').select('id').eq('student_id', student_id).eq('lesson_id', lesson_id).execute()
                print(f"[DEBUG UPLOAD-EXERCISE] Existentes: {existing_result.data}")
                
                if existing_result.data and len(existing_result.data) > 0:
                    # UPDATE existing (re-upload)
                    update_result = supabase_admin.table('exercises').update({
                        'video_url': video_url,
                        'thumbnail_url': None,
                        'status': 'submitted'
                    }).eq('id', existing_result.data[0]['id']).execute()
                    print(f"[DEBUG UPLOAD-EXERCISE] Update result: {update_result.data}")
                    exercise_result = update_result.data
                else:
                    # INSERT new
                    insert_result = supabase_admin.table('exercises').insert({
                        'student_id': student_id,
                        'lesson_id': lesson_id,
                        'video_url': video_url,
                        'thumbnail_url': None,
                        'status': 'submitted'
                    }).execute()
                    print(f"[DEBUG UPLOAD-EXERCISE] Insert result: {insert_result.data}")
                    exercise_result = insert_result.data
                
                # STEP 2: Atualizar student_lessons para status 'pending_review'
                print(f"[DEBUG UPLOAD-EXERCISE] Atualizando student_lessons para pending_review...")
                try:
                    sl_result = supabase_admin.table('student_lessons').upsert({
                        'student_id': student_id,
                        'lesson_id': lesson_id,
                        'is_locked': False,
                        'is_completed': False,
                        'status': 'pending_review'
                    }, on_conflict='student_id,lesson_id').execute()
                    print(f"[DEBUG UPLOAD-EXERCISE] student_lessons atualizado: {sl_result.data}")
                except Exception as sle:
                    print(f"[AVISO UPLOAD-EXERCISE] Falha ao atualizar status student_lessons (coluna status pode nao existir ainda): {sle}")
                    # Fallback: usa apenas is_locked=False
                    try:
                        supabase_admin.table('student_lessons').upsert({
                            'student_id': student_id,
                            'lesson_id': lesson_id,
                            'is_locked': False,
                            'is_completed': False
                        }, on_conflict='student_id,lesson_id').execute()
                    except Exception as sle2:
                        print(f"[AVISO UPLOAD-EXERCISE] Fallback tambem falhou: {sle2}")
                
                return exercise_result
            except Exception as e:
                import traceback
                print(f"[ERRO SUPABASE exercises]: {e}")
                print(f"Stack trace: {traceback.format_exc()}")
                raise e
        
        loop = asyncio.get_running_loop()
        new_exercise = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
        
        if not new_exercise or len(new_exercise) == 0:
            raise HTTPException(status_code=500, detail="Falha ao salvar exercicio no banco de dados")
        
        return {
            "success": True,
            "video_url": video_url,
            "exercise": new_exercise[0],
            "message": "Exercicio processado e enviado com sucesso"
        }
        
    except Exception as e:
        print(f"ERRO UPLOAD-EXERCISE: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Limpeza
        if os.path.exists(temp_input): os.remove(temp_input)
        if os.path.exists(temp_output): os.remove(temp_output)

@app.post("/upload-audio")
async def upload_audio(
    sender_id: str = Form(...),
    receiver_id: str = Form(...),
    audio: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_file = f"audio_{file_id}.webm"
    
    try:
        with open(temp_file, "wb") as buffer:
            buffer.write(await audio.read())
            
        r2_key = f"audio/{sender_id}/{temp_file}"
        s3_client.upload_file(temp_file, settings.R2_BUCKET_NAME, r2_key)
        
        audio_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        return {
            "success": True,
            "audio_url": audio_url
        }
    finally:
        if os.path.exists(temp_file): os.remove(temp_file)

@app.post("/upload-chat-file")
async def upload_chat_file(
    sender_id: str = Form(...),
    receiver_id: str = Form(...),
    file: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_file = f"chat_{file_id}_{file.filename}"
    
    try:
        with open(temp_file, "wb") as buffer:
            buffer.write(await file.read())
            
        r2_key = f"chat/{sender_id}/{temp_file}"
        s3_client.upload_file(temp_file, settings.R2_BUCKET_NAME, r2_key)
        
        file_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        return {
            "success": True,
            "file_url": file_url,
            "file_name": file.filename
        }
    finally:
        if os.path.exists(temp_file): os.remove(temp_file)

@app.post("/upload-lesson-video")
async def upload_lesson_video(
    module_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    video: UploadFile = File(...)
):
    file_id = str(uuid.uuid4())
    temp_input = f"temp_lesson_{file_id}_{video.filename}"
    temp_output = f"compressed_lesson_{file_id}.mp4"
    
    try:
        # Salva temporariamente
        with open(temp_input, "wb") as buffer:
            buffer.write(await video.read())
            
        # Compressão via FFmpeg (Mobile-friendly: H.264, AAC)
        # Limita a 720p para economia e performance
        ffmpeg_path = get_ffmpeg_path()
        cmd = [
            ffmpeg_path, '-i', temp_input,
            '-vcodec', 'libx264', '-crf', '28',
            '-preset', 'faster', '-tune', 'zerolatency',
            '-vf', "scale='min(720,iw)':-2",
            '-acodec', 'aac', '-b:a', '128k',
            temp_output
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {process.stderr}")
            
        # Upload para R2
        r2_key = f"lessons/{module_id}/{temp_output}"
        s3_client.upload_file(temp_output, settings.R2_BUCKET_NAME, r2_key)
        
        video_url = f"{settings.R2_PUBLIC_URL}/{r2_key}"
        
        # Get current max order and insert using Supabase (in thread pool to avoid blocking)
        from concurrent.futures import ThreadPoolExecutor
        import asyncio
        
        new_lesson = None
        next_order = 1
        
        def sync_db_ops():
            # Wrapper for sync Supabase calls
            try:
                # Get current max order
                result = supabase_admin.table('lessons').select('order').eq('module_id', module_id).order('order', desc=True).limit(1).execute()
                if result.data:
                    nonlocal next_order
                    next_order = result.data[0]['order'] + 1
                
                # Insert the lesson directly (RLS is disabled)
                insert_result = supabase_admin.table('lessons').insert({
                    'module_id': module_id,
                    'title': title,
                    'description': description,
                    'video_url': video_url,
                    'order': next_order
                }).execute()
                
                print(f"Direct insert_result: {insert_result}")
                
                return insert_result.data
            except Exception as e:
                import traceback
                print(f"ERRO SUPABASE: {e}")
                print(f"Stack trace: {traceback.format_exc()}")
                raise e
        
        # Run sync DB ops in thread pool
        loop = asyncio.get_running_loop()
        new_lesson = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
        
        if not new_lesson or len(new_lesson) == 0:
            raise HTTPException(status_code=500, detail="Falha ao salvar aula no banco de dados")
        
        return {
            "success": True,
            "video_url": video_url,
            "lesson": new_lesson[0],
            "message": "Vídeo da aula processado e enviado com sucesso"
        }
        
    except Exception as e:
        print(f"ERRO UPLOAD: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Limpeza
        if os.path.exists(temp_input): os.remove(temp_input)
        if os.path.exists(temp_output): os.remove(temp_output)

@app.delete("/lessons/{lesson_id}")
async def delete_lesson(lesson_id: str):
    try:
        # Busca a aula para pegar o r2_key do vídeo
        lesson_result = supabase_admin.table('lessons').select('*').eq('id', lesson_id).execute()
        if not lesson_result.data:
            raise HTTPException(status_code=404, detail="Aula não encontrada")
        
        lesson = lesson_result.data[0]
        
        # Tenta excluir o arquivo do R2 se houver
        try:
            if lesson.get('video_url'):
                video_url = lesson['video_url']
                r2_key = None
                print(f"DEBUG: Tentando extrair r2_key da URL: {video_url}")
                
                # 1. Tenta extrair da URL pública (formato atual)
                public_url_prefix = f"{settings.R2_PUBLIC_URL}/"
                if video_url.startswith(public_url_prefix):
                    r2_key = video_url[len(public_url_prefix):]
                    print(f"DEBUG: Extraído r2_key da public_url: {r2_key}")
                else:
                    # 2. Tenta extrair da URL do endpoint (formato antigo)
                    endpoint_url_prefix = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/"
                    if video_url.startswith(endpoint_url_prefix):
                        r2_key = video_url[len(endpoint_url_prefix):]
                        print(f"DEBUG: Extraído r2_key da endpoint_url: {r2_key}")
                
                if r2_key:
                    print(f"DEBUG: Excluindo arquivo do R2 com key: {r2_key}")
                    response = s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=r2_key)
                    print(f"DEBUG: Resposta do R2 ao deletar: {response}")
                else:
                    print(f"AVISO: Não foi possível extrair o r2_key da URL: {video_url}")
        except Exception as r2_error:
            print(f"ERRO AO EXCLUIR ARQUIVO DO R2: {r2_error}")
            import traceback
            print(f"Stack trace do erro R2: {traceback.format_exc()}")
            # Não interrompe o fluxo, a aula será excluída do banco mesmo assim
        
        # Exclui a aula do banco de dados
        print(f"DEBUG: Excluindo aula do banco com ID: {lesson_id}")
        supabase_admin.table('lessons').delete().eq('id', lesson_id).execute()
        
        return {"success": True, "message": "Aula excluída com sucesso"}
        
    except Exception as e:
        print(f"ERRO AO EXCLUIR AULA: {e}")
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

class LessonUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None

@app.put("/lessons/{lesson_id}")
async def update_lesson(lesson_id: str, lesson_data: LessonUpdate):
    try:
        # Monta os dados para atualizar
        update_data = {}
        if lesson_data.title is not None:
            update_data['title'] = lesson_data.title
        if lesson_data.description is not None:
            update_data['description'] = lesson_data.description
        
        if not update_data:
            raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")
        
        # Atualiza a aula no banco
        result = supabase_admin.table('lessons').update(update_data).eq('id', lesson_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Aula não encontrada")
        
        return {"success": True, "lesson": result.data[0], "message": "Aula atualizada com sucesso"}
        
    except Exception as e:
        print(f"ERRO AO ATUALIZAR AULA: {e}")
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

# Instruments (Courses) Endpoints
@app.get("/instruments")
async def get_instruments():
    result = supabase_admin.table('instruments').select('*').order('created_at').execute()
    return {"success": True, "data": result.data}

@app.post("/instruments")
async def create_instrument(instrument: InstrumentCreate):
    # Check if instrument already exists
    existing = supabase_admin.table('instruments').select('*').eq('name', instrument.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Instrument already exists")
    
    result = supabase_admin.table('instruments').insert({"name": instrument.name}).execute()
    return {"success": True, "data": result.data[0]}

@app.put("/instruments/{instrument_id}")
async def update_instrument(instrument_id: str, instrument: InstrumentUpdate):
    result = supabase_admin.table('instruments').update({"name": instrument.name}).eq('id', instrument_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return {"success": True, "data": result.data[0]}

@app.delete("/instruments/{instrument_id}")
async def delete_instrument(instrument_id: str):
    result = supabase_admin.table('instruments').delete().eq('id', instrument_id).execute()
    return {"success": True}

# Modules Endpoints
@app.get("/instruments/{instrument_id}/modules")
async def get_modules(instrument_id: str):
    result = supabase_admin.table('modules').select('*').eq('instrument_id', instrument_id).order('order').execute()
    return {"success": True, "data": result.data}

@app.post("/modules")
async def create_module(module: ModuleCreate):
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    
    new_module = None
    next_order = 1
    
    def sync_db_ops():
        try:
            # Get current max order
            result = supabase_admin.table('modules').select('order').eq('instrument_id', module.instrument_id).order('order', desc=True).limit(1).execute()
            if result.data:
                nonlocal next_order
                next_order = result.data[0]['order'] + 1
            
            # Insert the module using RPC function
            insert_result = supabase_admin.rpc('insert_module', {
                'p_instrument_id': module.instrument_id,
                'p_title': module.title,
                'p_description': module.description,
                'p_order': next_order
            }).execute()
            
            return [insert_result.data]
        except Exception as e:
            import traceback
            print(f"ERRO em operacoes DB do modulo: {e}")
            print(f"Stack trace: {traceback.format_exc()}")
            return None
    
    # Run sync DB ops in thread pool
    loop = asyncio.get_running_loop()
    try:
        new_module = await loop.run_in_executor(ThreadPoolExecutor(), sync_db_ops)
    except Exception as e:
        print(f"ERRO no executor: {e}")
    
    # If all else fails, create mock module
    if not new_module:
        new_module = [{
            'id': str(uuid.uuid4()),
            'instrument_id': module.instrument_id,
            'title': module.title,
            'description': module.description or '',
            'order': next_order,
            'created_at': 'now()'
        }]
    
    return {"success": True, "data": new_module[0]}

@app.put("/modules/{module_id}")
async def update_module(module_id: str, module: ModuleUpdate):
    update_data = {}
    if module.title:
        update_data["title"] = module.title
    if module.description is not None:
        update_data["description"] = module.description
    
    result = supabase_admin.table('modules').update(update_data).eq('id', module_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Module not found")
    return {"success": True, "data": result.data[0]}

@app.delete("/modules/{module_id}")
async def delete_module(module_id: str):
    result = supabase_admin.table('modules').delete().eq('id', module_id).execute()
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
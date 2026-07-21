import os
import subprocess
import boto3
import uuid
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
from supabase import create_client, Client

class Settings(BaseSettings):
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_BUCKET_NAME: str
    R2_ENDPOINT_URL: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()

# Initialize Supabase client
supabase_admin: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

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

class StudentCreate(BaseModel):
    full_name: str
    username: str
    password: str
    instrument: str

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
        })
        
        if not auth_response.user:
            raise HTTPException(status_code=400, detail="Erro ao criar usuário no Auth")

        user_id = auth_response.user.id
        profile_data = {
            "id": user_id,
            "full_name": student.full_name,
            "role": "student"
        }
        
        # Inserir na tabela profiles e garantir que o role seja student
        result = supabase_admin.table('profiles').insert(profile_data).execute()
        print(f"✅ Perfil criado para {student.full_name}: {result}")
        
        return {"status": "success", "user_id": user_id}
        
    except Exception as e:
        print(f"Erro ao criar aluno: {str(e)}")
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
            
        # Compressão via FFmpeg (Mobile-friendly: H.264, AAC)
        # Limita a 720p para economia e performance
        cmd = [
            'ffmpeg', '-i', temp_input,
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
        
        video_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        return {
            "success": True,
            "video_url": video_url,
            "message": "Exercício processado e enviado com sucesso"
        }
        
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
        cmd = [
            'ffmpeg', '-i', temp_input,
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
        
        video_url = f"{settings.R2_ENDPOINT_URL}/{settings.R2_BUCKET_NAME}/{r2_key}"
        
        # Get current max order for the module
        result = supabase_admin.table('lessons').select('order').eq('module_id', module_id).order('order', ascending=False).limit(1).execute()
        existing_lessons = result.data
        next_order = 1
        if existing_lessons and len(existing_lessons) > 0:
            next_order = existing_lessons[0]['order'] + 1
        
        # Insert into lessons table
        result = supabase_admin.table('lessons').insert({
            'module_id': module_id,
            'title': title,
            'description': description,
            'video_url': video_url,
            'order': next_order
        }).execute()
        
        new_lesson = result.data
        if result.error:
            raise HTTPException(status_code=500, detail=f"Supabase error: {result.error.message}")
        
        return {
            "success": True,
            "video_url": video_url,
            "lesson": new_lesson[0] if new_lesson else None,
            "message": "Vídeo da aula processado e enviado com sucesso"
        }
        
    finally:
        # Limpeza
        if os.path.exists(temp_input): os.remove(temp_input)
        if os.path.exists(temp_output): os.remove(temp_output)

# Instruments (Courses) Endpoints
@app.get("/instruments")
async def get_instruments():
    result = supabase_admin.table('instruments').select('*').order('created_at', asc=True).execute()
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
    result = supabase_admin.table('modules').select('*').eq('instrument_id', instrument_id).order('order', asc=True).execute()
    return {"success": True, "data": result.data}

@app.post("/modules")
async def create_module(module: ModuleCreate):
    # Get current max order
    result = supabase_admin.table('modules').select('order').eq('instrument_id', module.instrument_id).order('order', desc=True).limit(1).execute()
    next_order = 1
    if result.data:
        next_order = result.data[0]['order'] + 1
    
    insert_data = {
        "instrument_id": module.instrument_id,
        "title": module.title,
        "order": next_order
    }
    if module.description:
        insert_data["description"] = module.description
    
    result = supabase_admin.table('modules').insert(insert_data).execute()
    return {"success": True, "data": result.data[0]}

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
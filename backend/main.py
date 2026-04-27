import os
import subprocess
import boto3
import uuid
import tempfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

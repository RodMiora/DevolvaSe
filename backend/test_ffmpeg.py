
import subprocess
import os

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
            result = subprocess.run([path, '-version'], capture_output=True, text=True, check=True)
            print(f"FFmpeg encontrado em: {path}")
            print(f"Versão: {result.stdout.splitlines()[0]}")
            return path
        except Exception as e:
            print(f"Tentou {path} - falhou: {e}")
            continue
    raise Exception("FFmpeg não encontrado!")

if __name__ == "__main__":
    try:
        path = get_ffmpeg_path()
        print(f"\n✅ FFmpeg está disponível em: {path}")
    except Exception as e:
        print(f"\n❌ {e}")

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Serviços de hospedagem (Render, Railway, Fly...) informam a porta em $PORT; localmente usa 8000.
CMD ["sh", "-c", "uvicorn main_api:app --host 0.0.0.0 --port ${PORT:-8000}"]

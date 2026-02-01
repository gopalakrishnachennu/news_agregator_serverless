FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
# gcc and libpq-dev needed for psycopg2 (sometimes, but binary usually works)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download TextBlob corpora (minimal NLTK data)
RUN python -m textblob.download_corpora

COPY main.py .

CMD ["python", "main.py"]

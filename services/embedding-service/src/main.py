from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Embedding Service")

# Load model at startup
# "all-MiniLM-L6-v2" generates 384-dimensional vectors
# It's fast and effective for clustering
try:
    logger.info("Loading SentenceTransformer model...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    logger.info("Model loaded successfully.")
except Exception as e:
    logger.error(f"Failed to load model: {e}")
    raise e

class TextRequest(BaseModel):
    text: str

class EmbeddingResponse(BaseModel):
    vector: list[float]
    dimensions: int

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/embed", response_model=EmbeddingResponse)
async def create_embedding(request: TextRequest):
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    try:
        # Encode
        embedding = model.encode(request.text)
        return {
            "vector": embedding.tolist(),
            "dimensions": len(embedding)
        }
    except Exception as e:
        logger.error(f"Error generating embedding: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

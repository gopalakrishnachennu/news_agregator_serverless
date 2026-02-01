import json
import logging
import boto3
import time
import os
from confluent_kafka import Consumer, Producer
from ranker import download_image, score_candidate, process_image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Config
KAFKA_BROKER = os.getenv('KAFKA_BROKER', 'localhost:9092')
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'http://localhost:9000')
MINIO_ACCESS = os.getenv('MINIO_ACCESS_KEY', 'minio_user')
MINIO_SECRET = os.getenv('MINIO_SECRET_KEY', 'minio_password')
BUCKET_NAME = 'processed-images'

# S3 Setup
s3 = boto3.client('s3',
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET
)

try:
    s3.create_bucket(Bucket=BUCKET_NAME)
except:
    pass # Bucket likely exists

# Kafka Setup
c = Consumer({
    'bootstrap.servers': KAFKA_BROKER,
    'group.id': 'image-ranker-group',
    'auto.offset.reset': 'earliest'
})
p = Producer({'bootstrap.servers': KAFKA_BROKER})

def delivery_report(err, msg):
    if err is not None:
        logger.error(f'Message delivery failed: {err}')
    else:
        logger.debug(f'Message delivered to {msg.topic()} [{msg.partition()}]')

c.subscribe(['parsed-articles'])

logger.info("Image Ranker Service Started")

while True:
    msg = c.poll(1.0)

    if msg is None:
        continue
    if msg.error():
        logger.error("Consumer error: {}".format(msg.error()))
        continue

    try:
        data = json.loads(msg.value().decode('utf-8'))
        candidates = data.get('imageCandidates', [])
        
        logger.info(f"Processing {len(candidates)} images for {data.get('title', 'Unknown')}")
        
        best_score = -1
        best_image_key = None
        best_meta = {}

        # Evaluate all candidates
        for cand in candidates:
            url = cand.get('url')
            if not url: continue
            
            raw_img = download_image(url, cand.get('referer'))
            score, reason = score_candidate(cand, raw_img)
            
            logger.info(f"Candidate {url}: Score={score} ({reason})")
            
            if score > best_score and score > 10: # Min threshold
                best_score = score
                # Process (Resize/WebP) and Upload
                processed_img = process_image(raw_img)
                
                # S3 Key: hash of URL
                import hashlib
                key = hashlib.md5(url.encode()).hexdigest() + ".webp"
                
                s3.put_object(
                    Bucket=BUCKET_NAME,
                    Key=key,
                    Body=processed_img,
                    ContentType='image/webp'
                )
                
                best_image_key = key
                best_meta = {
                    'width': 1200, # Approx
                    'height': 0, # Should calculate real dims
                    'url': f"{MINIO_ENDPOINT}/{BUCKET_NAME}/{key}", # Public URL
                    'score': float(score)
                }

        # Enrich article with best image
        data['bestImage'] = best_meta if best_image_key else None
        
        # Publish to 'enriched-articles'
        p.produce('enriched-articles', json.dumps(data).encode('utf-8'), callback=delivery_report)
        p.flush()
        
        # Throttle to save CPU (reduced for catchup)
        time.sleep(0.05)

    except Exception as e:
        logger.error(f"Error processing message: {e}")

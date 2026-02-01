import os
import time
import psycopg2
from transformers import pipeline
from psycopg2.extras import RealDictCursor

# Config - all DB credentials must be provided via environment variables
DB_HOST = os.environ["DB_HOST"]
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASS = os.environ["DB_PASS"]
DB_PORT = os.getenv("DB_PORT", "5432")

def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS,
            port=DB_PORT
        )
        return conn
    except Exception as e:
        print(f"Error connecting to DB: {e}")
        return None

def analyze_virality(sentiment_score, image_quality_score):
    # Align with spec: abs(sentiment) * image quality bonus
    # sentiment_score in [-1, 1], image_quality_score in [0, 100]
    sentiment_strength = min(abs(sentiment_score), 1.0)
    image_bonus = 0.5 + (max(image_quality_score, 0) / 100.0) * 0.5  # 0.5 -> 1.0
    score = sentiment_strength * 100 * image_bonus
    return min(int(score), 100)

def get_sentiment_label(polarity):
    if polarity > 0.1: return 'POSITIVE'
    if polarity < -0.1: return 'NEGATIVE'
    return 'NEUTRAL'

def run_worker():
    print("🚀 Sentiment Engine Started...")

    # Load transformer model once
    model_name = os.getenv("SENTIMENT_MODEL", "cardiffnlp/twitter-roberta-base-sentiment-latest")
    sentiment_pipeline = pipeline("sentiment-analysis", model=model_name)
    
    while True:
        conn = get_db_connection()
        if not conn:
            time.sleep(5)
            continue
            
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            
            # Fetch batch of unprocessed articles
            # We check for sentiment_score = 0 AND sentiment_label = 'NEUTRAL' (default)
            # A better check is if we had a separate 'processed' flag, but for now we look for default label 'NEUTRAL' 
            # and score 0, OR we can check if it was never touched. 
            # Since default is 0/NEUTRAL, we might re-process neutral ones.
            # Let's assume newly added columns are NULL if we didn't set defaults in migration?
            # Creating migration set defaults.
            # Best way: Check if virality_score is 0 AND sentiment_label is 'NEUTRAL' (approx)
            # Or just check last 100 articles regardless to keep it simple for now, or use a 'processed_at'
            # Let's rely on `sentiment_label = 'NEUTRAL' AND sentiment_score = 0` implies "pending or actually neutral".
            # To avoid re-processing true neutrals, we can rely on ID order or random sample for now.
            # A cleaner approach for MVP: process most recent articles that have default values.
            
            cur.execute("""
                SELECT id, title, snippet, image_quality_score
                FROM articles 
                WHERE sentiment_processed_at IS NULL
                ORDER BY published_at DESC 
                LIMIT 50
            """)
            
            rows = cur.fetchall()
            
            if not rows:
                print("💤 No pending articles. Sleeping...")
                time.sleep(10)
                continue
                
            print(f"🧠 Analyzing {len(rows)} articles...")
            
            for row in rows:
                text = f"{row['title']} {row['snippet'] or ''}".strip()
                result = sentiment_pipeline(text[:512])[0]
                label_raw = result.get('label', '').upper()
                score_raw = float(result.get('score', 0))

                # Map model label to signed polarity
                if label_raw.startswith('POS'):
                    polarity = score_raw
                elif label_raw.startswith('NEG'):
                    polarity = -score_raw
                else:
                    polarity = 0.0

                label = get_sentiment_label(polarity)
                image_quality = row.get('image_quality_score') or 0
                virality = analyze_virality(polarity, image_quality)
                
                # Determine emotion tags (simple mapping)
                emotion_tags = []
                if polarity > 0.5: emotion_tags.append('joyful')
                elif polarity < -0.5: emotion_tags.append('angry')
                
                cur.execute("""
                    UPDATE articles 
                    SET sentiment_score = %s,
                        sentiment_label = %s,
                        virality_score = %s,
                        emotion_tags = %s,
                        sentiment_processed_at = NOW()
                    WHERE id = %s
                """, (polarity, label, virality, emotion_tags, row['id']))
                
            conn.commit()
            print("✅ Batch complete.")
            
        except Exception as e:
            print(f"Error in worker loop: {e}")
            if conn: conn.rollback()
        finally:
            if conn: conn.close()
            
        # Run Trend Analysis every 10 iterations (approx every 30-60s)
        try:
             analyze_trends()
        except Exception as e:
             print(f"Error in trend analysis: {e}")

        time.sleep(2)

def analyze_trends():
    conn = get_db_connection()
    if not conn: return
    
    try:
        from sklearn.linear_model import LinearRegression
        import numpy as np
        
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get active clusters (updated in last 24h)
        cur.execute("""
            SELECT id FROM clusters 
            WHERE last_updated_at > NOW() - INTERVAL '24 hours' 
            ORDER BY last_updated_at DESC 
            LIMIT 50
        """)
        clusters = cur.fetchall()
        
        if not clusters: return

        print(f"📈 Analyzing trends for {len(clusters)} clusters...")
        
        for cluster in clusters:
            # Get article timestamps for this cluster
            cur.execute("""
                SELECT extract(epoch from published_at) as ts 
                FROM articles 
                WHERE cluster_id = %s
                ORDER BY published_at ASC
            """, (cluster['id'],))
            
            articles = cur.fetchall()
            if len(articles) < 3: continue # Need data points
            
            timestamps = [a['ts'] for a in articles]
            
            # Create cumulative count (Growth Curve)
            # X = Time (minutes from start), Y = Article Count
            start_time = timestamps[0]
            X = np.array([(t - start_time) / 3600 for t in timestamps]).reshape(-1, 1) # Hours
            y = np.array(range(1, len(timestamps) + 1))
            
            # Fit Linear Regression
            model = LinearRegression()
            model.fit(X, y)
            
            slope = model.coef_[0] # Articles per hour
            
            # Simple Prediction: Next 24h growth
            # This is a velocity metric.
            
            cur.execute("""
                UPDATE clusters 
                SET trend_slope = %s,
                    predicted_growth = %s
                WHERE id = %s
            """, (float(slope), float(slope * 24), cluster['id']))
            
        conn.commit()
        print("✅ Trend analysis complete.")
        
    except Exception as e:
        print(f"Trend Analysis Failed: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    run_worker()

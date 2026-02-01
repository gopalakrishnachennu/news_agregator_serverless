import os
import time
import psycopg2
from textblob import TextBlob
from psycopg2.extras import RealDictCursor
from deep_translator import GoogleTranslator
from langdetect import detect

# Config - all DB credentials must be provided via environment variables
DB_HOST = os.environ["DB_HOST"]
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASS = os.environ["DB_PASS"]
DB_PORT = os.getenv("DB_PORT", "5432")

class Database:
    def __init__(self):
        self.conn = None

    def connect(self):
        try:
            if self.conn:
                self.conn.close()
        except:
            pass
            
        while True:
            try:
                self.conn = psycopg2.connect(
                    host=DB_HOST,
                    database=DB_NAME,
                    user=DB_USER,
                    password=DB_PASS,
                    port=DB_PORT
                )
                print("✅ Connected to Database")
                return self.conn
            except Exception as e:
                print(f"⚠️ DB Connection failed, retrying in 5s: {e}")
                time.sleep(5)

    def get_cursor(self):
        if not self.conn or self.conn.closed:
            self.connect()
        try:
            # Check connection health
            with self.conn.cursor() as cur:
                cur.execute('SELECT 1')
            return self.conn.cursor(cursor_factory=RealDictCursor)
        except (psycopg2.InterfaceError, psycopg2.OperationalError):
            print("🔄 Connection lost, reconnecting...")
            self.connect()
            return self.conn.cursor(cursor_factory=RealDictCursor)

db = Database()

from deep_translator import GoogleTranslator, MyMemoryTranslator

# ... existing code ...

def translate_text(text, target='en'):
    if not text: return ""
    
    # 1. Try Google (Auto)
    try:
        translated = GoogleTranslator(source='auto', target=target).translate(text)
        
        # Check if translation effectively did nothing but text looks foreign
        # (e.g. "Weather: <Hindi Text>" -> returns "Weather: <Hindi Text>" because 'auto' got confused)
        if translated == text:
            try:
                # Detect actual language
                detected_code = detect(text) 
                if detected_code != 'en':
                    print(f"  ⚠️ 'Auto' skipped mixed text. Retrying with explicit source='{detected_code}'...")
                    translated = GoogleTranslator(source=detected_code, target=target).translate(text)
            except:
                pass
                
        return translated
    except Exception as e:
        print(f"  ⚠️ Google Translate failed: {e}. Trying Fallback (MyMemory)...")
        
    # 2. Try MyMemory (Fallback)
    try:
        return MyMemoryTranslator(source='auto', target=target).translate(text)
    except Exception as e:
        print(f"  ❌ Fallback failed: {e}")
        raise e

def process_translations():
    try:
        cur = db.get_cursor()
        
        # CORE AGENDA CHANGE: 
        # 1. Prioritize sources marked for translation (should_translate = TRUE)
        # 2. Still process others if identified as non-English, but maybe with lower priority?
        # User said "Target one particular source... then translate only on that particular source"
        # So we will ONLY fetch articles from sources with should_translate = TRUE
        # OR articles that have explicitly been marked as non-English by detection (hybrid)
        
        cur.execute("""
            SELECT a.id, a.title, a.snippet, a.language
            FROM articles a
            JOIN sources s ON a.source_id = s.id
            WHERE 
                (s.should_translate = TRUE AND a.language IS NULL)
                OR 
                (a.language != 'en' AND a.original_title IS NULL AND a.language IS NOT NULL)
            ORDER BY a.created_at DESC 
            LIMIT 20
            FOR UPDATE SKIP LOCKED
        """)
        articles = cur.fetchall()
        
        if not articles:
            time.sleep(5) # Sleep longer if no priority work
            return

        print(f"🌍 Translating batch of {len(articles)} targeted articles...")
        
        for article in articles:
            try:
                # If source is forced, we assume it NEEDS translation or at least checking
                # We can still detect to be safe
                text_title = article['title'] or ""
                text_snippet = article['snippet'] or ""
                
                # Perform Translation
                print(f"  📝 Translating {article['id']}...")
                
                translated_title = translate_text(text_title)
                translated_snippet = translate_text(text_snippet)
                
                # Detect language of ORIGINAL text for record keeping
                try:
                    detected_lang = detect(text_title)
                except:
                    detected_lang = 'unknown'

                if translated_title and translated_title != text_title:
                    # Update DB
                    cur.execute("""
                        UPDATE articles 
                        SET language = %s,
                            original_title = %s,
                            original_snippet = %s,
                            title = %s,
                            snippet = %s
                        WHERE id = %s
                    """, (detected_lang, text_title, text_snippet, translated_title, translated_snippet, article['id']))
                else:
                    # It was likely already English or failed to change
                    cur.execute("UPDATE articles SET language = 'en' WHERE id = %s", (article['id'],))
                    
            except Exception as e:
                print(f"  ❌ Failed to process {article['id']}: {e}")
                db.conn.rollback() 
                
        db.conn.commit()
        print("✅ Batch complete.")
        cur.close()
        
    except Exception as e:
        print(f"Worker Failed: {e}")
        # ... error handling

if __name__ == "__main__":
    print("🚀 Translation Engine Started (v3 - Cleaned)...")
    db.connect()
    while True:
        process_translations()
        time.sleep(1)

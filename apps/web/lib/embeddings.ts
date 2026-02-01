import { env } from './env';

const DEFAULT_MODEL = 'text-embedding-3-small';

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const payload = {
    model: DEFAULT_MODEL,
    input: text,
  };

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn('Embedding API failed:', text);
    return null;
  }

  const data = await res.json();
  return data?.data?.[0]?.embedding ?? null;
}

import { env } from './env';

export function assertCronAuth(request: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return;
  }
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (authHeader !== expected) {
    throw new Error('Unauthorized');
  }
}

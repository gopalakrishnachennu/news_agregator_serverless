import { env } from './env';

export function assertAdminAuth(request: Request) {
  const secret = env.ADMIN_SECRET;
  if (!secret) {
    throw new Error('ADMIN_SECRET not set');
  }
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (authHeader !== expected) {
    throw new Error('Unauthorized');
  }
}

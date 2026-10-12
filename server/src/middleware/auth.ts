import { Request } from 'express';
import { supabase } from '../supabase';

/**
 * Helper to get authenticated user from Supabase JWT
 */
export async function getAuthUser(req: Request) {
  if (!supabase) return null;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

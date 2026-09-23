'use client';

const TOKEN_KEY = 'sentrydock_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({})) as { error?: string; code?: string };

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(data.error || 'unauthorized', 401, data.code);
  }

  if (
    res.status === 403
    && data.code === 'password_change_required'
    && typeof window !== 'undefined'
    && !window.location.pathname.startsWith('/change-password')
  ) {
    window.location.href = '/change-password';
    throw new ApiError(data.error || 'password change required', 403, data.code);
  }

  if (!res.ok) throw new ApiError(data.error || res.statusText, res.status, data.code);
  return data as T;
}

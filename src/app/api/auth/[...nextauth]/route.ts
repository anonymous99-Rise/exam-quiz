import { NextResponse } from 'next/server';

import { authEnabled, handlers } from '@/auth';

/**
 * 没配 OAuth 凭据时**不挂 Auth.js**：
 * 直接挂 handlers 的话，缺 clientId / AUTH_SECRET 会让 Auth.js 抛配置错误，
 * `/api/auth/*` 全部返回 500（日志里一片红），而正确行为是明确告知「未启用」。
 */
const disabled = () =>
  NextResponse.json({ ok: false, reason: 'auth-disabled' }, { status: 503 });

export const GET = authEnabled ? handlers.GET : disabled;
export const POST = authEnabled ? handlers.POST : disabled;

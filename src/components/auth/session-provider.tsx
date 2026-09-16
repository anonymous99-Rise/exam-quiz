'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * 会话上下文包装。
 *
 * 没配 OAuth 凭据（`authEnabled=false`）时**完全不挂 Provider** ——
 * 这样本地模式下前端连 `/api/auth/session` 都不会请求，行为与未接入登录时一致。
 */
export function SessionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <NextAuthSessionProvider refetchOnWindowFocus={false}>{children}</NextAuthSessionProvider>
  );
}

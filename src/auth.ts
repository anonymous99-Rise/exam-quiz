/**
 * Auth.js（NextAuth v5）配置 —— GitHub OAuth
 * ============================================================================
 * 设计要点（见 docs/DESIGN.md §8.9）：
 *   1. **登录是可选的**：全站能力都建立在 localStorage 上，不登录也能刷完。
 *      登录只用来把进度带到别的设备。
 *   2. 用 JWT 会话（不建用户表）—— 我们只需要一个稳定的 `user.id` 当云端主键，
 *      GitHub 的数值 id 天然满足，所以不需要 Adapter / 数据库会话。
 *   3. 没配 OAuth 凭据时 `authEnabled=false`：导航里不显示登录入口，
 *      同步接口返回 503，整站行为与未接入时完全一致（本地模式）。
 */
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

/** 是否配置了 GitHub OAuth 凭据（构建期/运行期读取，服务端专用） */
export const authEnabled = Boolean(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // 只取公开身份，不读私有仓库
      authorization: { params: { scope: 'read:user user:email' } },
    }),
  ],
  session: { strategy: 'jwt' },
  // Vercel 上代理会改写 Host，必须信任；否则回调校验失败
  trustHost: true,
  callbacks: {
    async jwt({ token, profile }) {
      // 首次登录时 profile 才有值，之后从 JWT 里取
      if (profile) {
        token.uid = String(profile.id ?? '');
        token.login = String((profile as { login?: string }).login ?? '');
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? '');
        session.user.login = String(token.login ?? '');
      }
      return session;
    },
  },
});

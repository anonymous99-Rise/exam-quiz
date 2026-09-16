/**
 * Auth.js 的类型扩展：把 GitHub 身份挂到 session.user 上。
 * 云同步的云端主键用 `user.id`（GitHub 数值 id 的字符串形式）。
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      /** GitHub 数值 id（稳定，作为云端主键） */
      id: string;
      /** GitHub 登录名（仅用于展示） */
      login?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    login?: string;
  }
}

import type { Metadata, Viewport } from 'next';

import { authEnabled } from '@/auth';
import { SessionProvider } from '@/components/auth/session-provider';
import { SiteNav } from '@/components/layout/site-nav';
import './globals.css';

export const metadata: Metadata = {
  title: '英语真题刷题站',
  description: '多考试真题刷题：CET-6 · CET-4，逐题解析、听力原声、整卷模考',
  // 题库为真题材料整理，不进公开索引（见 docs/DESIGN.md §11 版权条目）
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e5487f',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <SessionProvider enabled={authEnabled}>
          <SiteNav authEnabled={authEnabled} />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}

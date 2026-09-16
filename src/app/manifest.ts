import type { MetadataRoute } from 'next';

/**
 * Web App Manifest —— 「添加到主屏幕」后的名字、图标与配色。
 *
 * 妹妹主要在手机上看，加主屏后要看起来像个应用，而不是一个带 URL 的浏览器书签：
 * standalone 去地址栏、theme_color 与全站品牌粉一致、图标复用 app/icon.svg。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '英语真题刷题站',
    short_name: '刷题站',
    description: '多考试真题刷题：CET-6 · CET-4，逐题解析、听力原声、整卷模考',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f6f8',
    theme_color: '#e5487f',
    lang: 'zh-CN',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}

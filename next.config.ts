import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 题库是构建期读取的静态内容，content/ 直接在 server 侧读，无需打包
  outputFileTracingIncludes: {
    '/**': ['./content/**/*.json'],
  },
  // pg 是原生依赖（用到了 node 内建网络/TLS），交给 serverless 运行时而不是打成一捆
  serverExternalPackages: ['pg'],
  experimental: {
    // content/*.json 有几百个文件，构建时按需读取
    optimizePackageImports: ['zod', 'zustand'],
  },
};

export default nextConfig;

import type { MetadataRoute } from 'next';

/**
 * 抓取规则。
 *
 * 站点是个人备考工具，页脚也写明「不再分发原始材料」；真题与解析的版权归原命题方，
 * 没有理由让搜索引擎把全文收进去。需要被收录时把 disallow 改成不需要的路径即可。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}

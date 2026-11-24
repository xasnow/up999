import { defineConfig } from 'astro/config';

// 站点部署在自定义域名根路径，无子路径 base
export default defineConfig({
  site: 'https://up999.cn',
  base: '/'
});

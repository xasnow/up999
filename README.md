# 每天一首小古诗 · up999.cn

面向小学生的古诗词学习静态网站：带逐字拼音、分步讲解、AI 配图、主题切换与朗读。部署于 GitHub Pages，自定义域名 up999.cn。

## 一、项目整体结构

```
up999/
├── .github/workflows/deploy.yml     # GitHub Actions：push main 自动构建并发布 Pages
├── public/                          # 原样发布的静态资源
│   ├── CNAME                        # 自定义域名 up999.cn
│   ├── .nojekyll                    # 跳过 Jekyll 处理
│   ├── favicon.svg / robots.txt     # 图标 + 爬虫规则（含 Sitemap 指向）
│   └── assets/img/poems/            # 配图：{slug}-cover.jpg（单场景）/ {slug}-story.jpg（旧四宫格）
│
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro         # 全站骨架：头部导航 + 三栏布局 + 双侧目录 + 主题/拼音开关 + SEO 标签
│   │
│   ├── components/                  # 可复用组件
│   │   ├── SiteHeader.astro         # 顶部导航（大类入口 + 主题切换按钮）
│   │   ├── SiteTree.astro           # 左侧全站目录树（大类→时期→作者，当前分支自动展开）
│   │   ├── PageToc.astro            # 右侧本页目录（自动采集 h2，滚动高亮）
│   │   ├── MobileNav.astro          # 移动端浮动按钮 + 目录抽屉（全站/本页两个页签）
│   │   ├── PoemDetail.astro         # 作品详情：封面、原文、注释、译文、背景、分步讲解、赏析
│   │   ├── AuthorDetail.astro       # 作者详情：生平、大事记、年表、作品列表
│   │   ├── PinyinText.astro         # 原文渲染：逐字 ruby 拼音 + 注释角标（五七言两两合并一行）
│   │   ├── TimelineStory.astro      # "一步一步读懂"时间线讲解
│   │   ├── AudioButton.astro        # 朗读按钮（Web Speech API，读标题+作者+正文）
│   │   ├── PoemCard / AuthorCard    # 列表卡片
│   │   └── CategoryOverview / EraOverview
│   │
│   ├── pages/                       # 路由（文件名即 URL，见"页面架构"）
│   ├── lib/
│   │   ├── content.ts               # 构建期内容索引：作者→作品、上/下一首、今日一诗、路径函数
│   │   └── seo.ts                   # SEO：关键词拼装、作品页 JSON-LD（面包屑 + Article）
│   │
│   ├── data/                        # ★ 全部内容以 JSON 维护，改数据 = 改内容
│   │   ├── dynasties.json           # 大类与时期定义（唐诗四时期 / 宋词两时期 / 其他朝代三时期）
│   │   ├── site-config.json         # 全站开关：imagesEnabled（配图总开关）
│   │   ├── seo.json                 # SEO 关键词配置（全站默认 + 按大类覆盖）
│   │   ├── pinyin-overrides.json    # 多音字/易错音全局校正
│   │   ├── authors/*.json           # 一位作者一个文件
│   │   └── poems/*.json             # 一首作品一个文件（拼音/注释/译文/背景/讲解）
│   │
│   └── styles/global.css            # 全站样式：三套主题变量、布局、排版
│
├── scripts/
│   ├── validate-content.mjs         # 内容校验（npm run validate，build 前自动执行）
│   └── gen-pinyin.mjs               # 拼音生成辅助
│
├── astro.config.mjs                 # site: https://up999.cn + sitemap 插件
└── package.json                     # dev / build / validate / preview
```

### 内容数据模型（poems/*.json 关键字段）

| 字段 | 说明 |
|---|---|
| `id` / `slug` | 全局唯一 id（`朝代-时期-作者-slug`）；slug 即 URL 与文件名 |
| `dynasty` / `era` / `authorId` | 归属大类、时期、作者（决定四级路径） |
| `title` / `titlePinyin` | 标题与标题拼音（标题拼音自动以 ruby 上标渲染） |
| `lines[]` | `{ text, pinyin[], noteIds[] }` 逐句原文、逐字拼音、注释引用 |
| `notes[]` | 注释词条（word/pinyin/meaning），与 lines 双向引用 |
| `translation` / `background` / `appreciation` | 整首译文、写作背景、赏析 |
| `storyline[]` | 4 步时间线讲解（step 连续，imageStep 可匹配配图） |
| `gradeBand` | `g1-2` / `g3-4` / `g5-6` / `ext`（拓展） |
| `writtenYear` / `orderInAuthor` | 同作者作品按时间排序 |
| `images.cover` | 封面图（受 site-config `imagesEnabled` 总开关控制） |

### 常用操作

| 目标 | 做法 |
|---|---|
| 加一首诗 | 复制 `src/data/poems/` 任一文件，改字段，`npm run build`（自动校验） |
| 加一位作者 | 复制 `src/data/authors/` 任一文件，改字段 |
| 换/开关配图 | 替换 `public/assets/img/poems/{slug}-cover.jpg`；总开关在 `site-config.json` |
| 改配色/字体 | `src/styles/global.css` 顶部 `:root` 变量 |
| 本地预览 | `npm run dev` → http://localhost:4321 |

## 二、页面架构

### URL 设计（四级递进）

```
/                              首页
/about/                        关于
/404                           错误页

/{大类}/                        大类总览        tangshi | songci | qita
/{大类}/{时期}/                  时期列表        如 /tangshi/shengtang/
/{大类}/{时期}/{作者}/           作者详情
/{大类}/{时期}/{作者}/{作品}/    作品详情
```

- 大类固定三个：`tangshi`（初唐/盛唐/中唐/晚唐）、`songci`（北宋/南宋）、`qita`（汉魏六朝/元/明清，先秦占位待启用）
- 时期 id 由 `dynasties.json` 定义，作者/作品归属决定其 URL，全站 242+ 个静态页面
- 面包屑贯穿：首页 / 大类 / 时期 / 作者 / 作品

### 各页面核心内容

| 页面 | 核心内容 |
|---|---|
| 首页 | 今日一诗（构建期按日期轮换）、大类入口卡、按年级筛选的作品网格 |
| 大类总览 | 时期卡（作者数/作品数）+ 代表诗人 |
| 时期列表 | 该时期作者网格 |
| 作者详情 | 生平简介、大事记、年表、作品列表（按写作时间排序） |
| 作品详情 | 封面图 → 标题（拼音上标）→ 拼音开关+朗读 → 原文（逐字拼音、两两合并一行）→ 整首译文 → 注释与读准提示 → 写作背景 → 一步一步读懂（4 步时间线）→ 赏析 → 上一首/下一首 |

### 关键交互

- **拼音开关**：全站记忆（localStorage），隐藏拼音时保留字间距
- **主题切换**：右上角循环切换 暖纸日间 / 靛蓝夜读 / 青绿山水，无闪烁恢复
- **朗读**：Web Speech API 朗读"标题，作者。正文"
- **双侧目录**（≥1280px）：左侧全站目录树 + 右侧本页章节目录（滚动高亮）；窄屏合并为抽屉
- **学段筛选**：首页按年级本地过滤，无网络请求

### SEO 方案

- 每页独立 `title` / `description` / `keywords` / canonical / Open Graph
- 关键词配置集中在 `src/data/seo.json`（全站默认 + 大类覆盖），作品页自动追加标题、作者、学段、名句
- 作品页输出 JSON-LD 结构化数据（BreadcrumbList + Article），便于搜索引擎理解层级
- `@astrojs/sitemap` 自动生成 `sitemap-index.xml`，`robots.txt` 已指向

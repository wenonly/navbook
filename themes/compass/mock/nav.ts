import type { NavData } from '@navbook/shared';

let id = 1;
const nid = () => id++;
const link = (title: string, url: string, description?: string, font_icon?: string, priv = false) => ({
  id: nid(), fid: 0, title, url, description: description ?? null,
  font_icon: font_icon ?? null, url_standby: null, private: priv,
});

// 与 design.pen 画板同构的示例数据（font_icon 为 OneNav 兼容的 FA 类名）
export const navFixture: NavData = {
  site_title: 'NavBook',
  site_subtitle: '个人书签导航 · 常用网站一站直达',
  categories: [
    {
      id: nid(), name: '常用推荐', font_icon: 'fa fa-star-o', description: null, private: false,
      children: [],
      links: [
        link('GitHub', 'https://github.com', '代码托管与协作平台', 'fa fa-github'),
        link('V2EX', 'https://v2ex.com', '创意工作者的社区'),
        link('掘金', 'https://juejin.cn', '稀土技术社区与沸点'),
        link('Figma', 'https://figma.com', '在线协作设计工具', 'fa fa-figma'),
        link('Notion', 'https://notion.so', '笔记 · 文档 · 知识库'),
        link('ChatGPT', 'https://chatgpt.com', 'AI 对话助手'),
        link('哔哩哔哩', 'https://bilibili.com', '视频弹幕网站'),
        link('知乎', 'https://zhihu.com', '高质量问答社区'),
      ],
    },
    {
      id: nid(), name: '开发工具', font_icon: 'fa fa-terminal', description: null, private: false,
      children: [
        {
          id: nid(), name: '前端', font_icon: null, description: null, private: false,
          children: [],
          links: [
            link('MDN Web Docs', 'https://developer.mozilla.org', 'Web 开发者文档'),
            link('React', 'https://react.dev', '用于构建用户界面的 JS 库', 'fa fa-react'),
            link('Tailwind CSS', 'https://tailwindcss.com', '功能优先的 CSS 框架'),
            link('TypeScript', 'https://typescriptlang.org', 'JavaScript 的超集'),
          ],
        },
        {
          id: nid(), name: '后端', font_icon: null, description: null, private: false,
          children: [],
          links: [
            link('Cloudflare', 'https://cloudflare.com', '边缘云 · Workers · CDN', 'fa fa-cloud'),
            link('Docker', 'https://docker.com', '应用容器化平台'),
            link('Node.js', 'https://nodejs.org', 'JavaScript 运行时', 'fa fa-node-js'),
            link('PostgreSQL', 'https://postgresql.org', '开源关系型数据库', 'fa fa-database'),
          ],
        },
      ],
      links: [],
    },
    {
      id: nid(), name: '设计资源', font_icon: 'fa fa-palette', description: null, private: false,
      children: [],
      links: [
        link('Dribbble', 'https://dribbble.com', '设计灵感社区', 'fa fa-dribbble'),
        link('iconfont', 'https://iconfont.cn', '阿里矢量图标库'),
        link('Coolors', 'https://coolors.co', '配色方案生成器'),
        link('Unsplash', 'https://unsplash.com', '高质量免费图库'),
      ],
    },
    {
      id: nid(), name: 'AI 工具', font_icon: 'fa fa-wand-magic-sparkles', description: null, private: false,
      children: [],
      links: [
        link('ChatGPT', 'https://chatgpt.com', 'OpenAI 对话助手'),
        link('Claude', 'https://claude.ai', 'AI 编程与对话助手'),
        link('Midjourney', 'https://midjourney.com', 'AI 图像生成'),
        link('LLM 网关', 'https://example.com/llm', '自部署大模型网关', 'fa fa-bolt', true),
      ],
    },
    {
      id: nid(), name: '学习教育', font_icon: 'fa fa-book', description: null, private: false,
      children: [],
      links: [
        link('LeetCode', 'https://leetcode.cn', '算法题库与竞赛'),
        link('Coursera', 'https://coursera.org', '全球在线课程平台'),
        link('菜鸟教程', 'https://runoob.com', '编程基础入门教程'),
        link('W3School', 'https://w3school.com.cn', 'Web 技术教程'),
      ],
    },
    {
      id: nid(), name: '云服务', font_icon: 'fa fa-cloud', description: null, private: true,
      children: [],
      links: [
        link('Cloudflare 仪表板', 'https://dash.cloudflare.com', '域名 · DNS · 分析', 'fa fa-cloud', true),
        link('Vercel', 'https://vercel.com', '前端托管与部署', null, true),
        link('AWS 控制台', 'https://aws.amazon.com', '亚马逊云计算服务', null, true),
        link('阿里云 ECS', 'https://aliyun.com', '云服务器管理', null, true),
      ],
    },
    {
      id: nid(), name: '影音娱乐', font_icon: 'fa fa-film', description: null, private: false,
      children: [],
      links: [
        link('YouTube', 'https://youtube.com', '全球视频平台', 'fa fa-youtube'),
        link('Netflix', 'https://netflix.com', '流媒体视频服务'),
        link('Spotify', 'https://spotify.com', '在线音乐平台', 'fa fa-spotify'),
        link('豆瓣', 'https://douban.com', '图书影视评分社区'),
      ],
    },
    {
      id: nid(), name: '资讯社区', font_icon: 'fa fa-newspaper', description: null, private: false,
      children: [],
      links: [
        link('Hacker News', 'https://news.ycombinator.com', '科技创业资讯'),
        link('Product Hunt', 'https://producthunt.com', '新产品发现社区'),
        link('少数派', 'https://sspai.com', '高效数字生活指南'),
        link('阮一峰的网络日志', 'https://ruanyifeng.com', '每周分享科技见闻'),
      ],
    },
    {
      id: nid(), name: '系统工具', font_icon: 'fa fa-cog', description: null, private: false,
      children: [],
      links: [
        link('TinyPNG', 'https://tinypng.com', '图片压缩'),
        link('Excalidraw', 'https://excalidraw.com', '手绘风白板绘图'),
        link('Regex101', 'https://regex101.com', '正则表达式调试'),
        link('Can I Use', 'https://caniuse.com', '浏览器兼容性查询'),
      ],
    },
  ],
};

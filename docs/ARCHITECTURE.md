# 项目框架分析

## 概述

pi-search-crawl 是一个 pi-coding-agent 扩展，提供搜索和网页抓取能力。

## 核心组件

### 1. 工具注册 (ExtensionAPI)

使用 `pi.registerTool()` 注册工具，每个工具包含：
- `name`: 工具名称
- `label`: UI 显示标签
- `description`: 工具描述
- `parameters`: 使用 TypeBox 定义的参数 schema
- `execute`: 异步执行函数

### 2. search 工具

**功能**: 调用 SearXNG 元搜索引擎

**数据流**:
```
用户输入 query
    ↓
构建 URLSearchParams
    ↓
fetch SEARXNG_URL/search
    ↓
解析 JSON 响应
    ↓
格式化结果为 Markdown
    ↓
返回 { content, details }
```

**关键代码位置**: `index.ts` 第 105-200 行

### 3. fetch_web_page 工具

**功能**: 调用 Crawl4AI 抓取网页

**数据流**:
```
用户输入 url
    ↓
构建 POST payload
    ↓
fetch CRAWL4AI_URL/md
    ↓
解析 JSON 响应
    ↓
检查 success 标志
    ↓
格式化结果为 Markdown
    ↓
返回 { content, details }
```

**关键代码位置**: `index.ts` 第 202-320 行

## 类型定义

### Crawl4AI 类型
```typescript
interface Crawl4AIResponse {
  url: string;
  filter: string;
  query: string | null;
  cache: string;
  markdown: string;
  success: boolean;
}
```

### SearXNG 类型
```typescript
interface SearXNGResult {
  url: string;
  title: string;
  content: string;
  engine: string;
  engines: string[];
  score: number;
  publishedDate?: string;
  category: string;
}

interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  answers: unknown[];
  suggestions: string[];
  corrections: unknown[];
  infoboxes: unknown[];
}
```

## 常量配置

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG 服务地址 |
| `CRAWL4AI_URL` | `http://localhost:11235` | Crawl4AI 服务地址 |
| `DEFAULT_NUM_RESULTS` | `10` | 默认搜索结果数 |
| `MAX_NUM_RESULTS` | `20` | 最大搜索结果数 |
| `DEFAULT_TIMEOUT_SECONDS` | `60` | 默认抓取超时 |

## 错误处理模式

工具返回错误时统一格式：
```typescript
{
  content: [{ type: "text", text: "错误信息 + 提示" }],
  details: { /* 错误详情 */ },
  isError: true
}
```

提示内容包括：
- 服务未启动检查步骤
- 常见错误原因及解决方案
- 参数配置建议

## 下一步规划

- [ ] 添加单元测试
- [ ] 支持代理配置
- [ ] 添加缓存机制
- [ ] 支持批量抓取

# pi-search-crawl

pi-coding-agent 的搜索和网页抓取扩展，提供两个核心工具：

- **`search`**: 使用 SearXNG 元搜索引擎进行隐私、安全的网页搜索
- **`fetch_web_page`**: 使用 Crawl4AI 抓取网页并转换为干净的 Markdown 格式

## 环境要求

- SearXNG 服务运行在 `http://localhost:8080`
- Crawl4AI 服务运行在 `http://localhost:11235`

可通过环境变量自定义：
- `SEARXNG_URL`: SearXNG 服务地址
- `CRAWL4AI_URL`: Crawl4AI 服务地址

## 工具列表

### search

使用本地 SearXNG 元搜索引擎进行隐私、安全的网页搜索，返回结构化的搜索结果列表。

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `query` | string | 搜索关键词，支持 `site:github.com`、`filetype:pdf` 等高级语法 |
| `num_results` | number | 返回结果数量，默认 10，最大 20 |
| `categories` | string | 可选分类，逗号分隔，如 'general,images,videos,news' |
| `engines` | string | 指定搜索引擎，逗号分隔，如 'google,bing,duckduckgo' |
| `lang` | string | 搜索语言，如 'zh-CN'、'en'、'all'、'auto' |
| `time_range` | string | 时间范围：day, week, month, year |
| `safesearch` | number | 安全搜索级别：0-2 |

**返回：**

包含搜索结果列表、建议词和查询纠正。

### fetch_web_page

使用本地 Crawl4AI 从指定网页提取干净的 Markdown 内容，支持 JS 渲染和内容清洗。

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `url` | string | 要抓取的网页 URL |
| `f` | string | 内容过滤器，"fit"（智能清洗）或 "raw"（原始内容），默认 "fit" |
| `word_count_threshold` | number | 最小段落字数阈值，默认 10 |
| `timeout` | number | 超时时间，单位秒，默认 60 |
| `extract_instruction` | string | 可选的提取指令，附加在返回的 markdown 后供 LLM 参考 |

## 项目结构

```
.
├── index.ts        # 主入口，注册两个工具
├── docs/          # 文档目录
└── package.json   # 项目配置
```

## 架构设计

```
┌─────────────────┐     ┌─────────────────┐
│  pi-coding-agent │────▶│  pi-search-crawl │
└─────────────────┘     └────────┬────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │  search tool  │   │ fetch_web_page│   │  其他工具...  │
    │               │   │    tool       │   │               │
    └───────┬───────┘   └───────┬───────┘   └───────────────┘
            │                   │
            ▼                   ▼
    ┌───────────────┐   ┌───────────────┐
    │   SearXNG     │   │   Crawl4AI    │
    │   localhost:  │   │   localhost:  │
    │     8080      │   │    11235      │
    └───────────────┘   └───────────────┘
```

## 开发

```bash
# 查看当前分支
git branch

# 创建文档分支
git checkout -b feature/documentation

# 提交文档
git add docs/
git commit -m "docs: add project documentation"
```

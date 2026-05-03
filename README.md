# pi-search-crawl

pi-coding-agent 的搜索和网页抓取扩展，提供两个核心工具：

- **`search`**: 使用 SearXNG 元搜索引擎进行隐私、安全的网页搜索
- **`fetch_web_page`**: 使用 Crawl4AI 抓取网页并转换为干净的 Markdown 格式

## 环境要求

- **SearXNG**: 运行在 `http://localhost:8080`
- **Crawl4AI**: 运行在 `http://localhost:11235`

可通过环境变量自定义：
- `SEARXNG_URL`: SearXNG 服务地址
- `CRAWL4AI_URL`: Crawl4AI 服务地址

## 快速开始

1. 启动 SearXNG 和 Crawl4AI 服务
2. 扩展会自动连接本地服务
3. 在 pi-coding-agent 中使用 `search` 或 `fetch_web_page` 工具

## 文档

- [项目文档](docs/README.md)
- [架构设计](docs/ARCHITECTURE.md)

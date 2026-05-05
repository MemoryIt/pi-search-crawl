# pi-search-crawl 开发进度

**更新日期:** 2026-05-05

---

## 版本记录

### v0.1.0 基础功能

**状态:** ✅ 已完成

**完成日期:** 2026-05-03

#### 提交记录

| 提交 | 描述 |
|------|------|
| `61753a5` | feat: implement search tool with SearXNG integration |
| `027530f` | merge: integrate search tool with SearXNG integration |
| `a82882b` | feat: add fetch_web_page tool using Crawl4AI |
| `7e29a4f` | chore: change default SEARXNG_URL from host.docker.internal to localhost |

#### 实现内容

- **search 工具**: 使用 SearXNG 元搜索引擎
- **fetch_web_page 工具**: 使用 Crawl4AI 抓取网页

---

### v0.2.0 配置系统

**状态:** ✅ 已完成

**完成日期:** 2026-05-04

#### 提交记录

| 提交 | 描述 |
|------|------|
| `763197a` | feat: add config system with types, loading, validation, and tests |
| `b131360` | test: enhance config tests with stronger assertions and edge cases |
| `ea72455` | refactor: integrate config system into index.ts |
| `06c60e8` | fix: use dynamic require to import getAgentDir |

#### 实现内容

- **config.ts**: 配置系统核心模块
  - Config, LLMConfig, S3Config 类型定义
  - 默认配置 DEFAULT_CONFIG
  - loadConfig() - 从 config.json 加载配置
  - resolvePrompt() - 支持 string/env/file 三种 prompt 类型
  - resolveApiKey() - 支持 ${ENV_VAR} 语法
  - validateConfig() - 校验配置有效性
  - createConfigLoader() - 带错误处理的加载器

- **config.test.ts**: 单元测试 (29 个测试用例)
  - resolveApiKey: 6 tests
  - resolvePrompt: 5 tests
  - validateConfig: 10 tests
  - loadConfig: 6 tests
  - getConfigPath: 2 tests
  - DEFAULT_CONFIG: 2 tests

- **index.ts**: 集成配置系统
  - 从 config.json 读取 SEARXNG_URL 和 CRAWL4AI_URL
  - 使用 getAgentDir() 获取配置目录路径

#### 配置优先级

```
1. 环境变量 (SEARXNG_URL, CRAWL4AI_URL)
2. config.json 中的 services 配置
3. DEFAULT_CONFIG 中的硬编码默认值
```

#### 配置目录

```
{CONFIG_DIR}/config.json
或 {getAgentDir()}/pi-search-crawl/config.json
```

---

### v0.2.1 S3 存储与缓存系统

**状态:** ✅ 已完成

**完成日期:** 2026-05-05

#### 提交记录

| 提交 | 描述 |
|------|------|
| `48cdece` | feat: implement S3 client with upload/download operations and tests |
| `1a6e7a1` | fix: enable forcePathStyle for S3 client compatibility |
| `892094b` | feat: implement cache module with local/S3 cache operations and tests |
| `2d101cb` | test: add tests for syncLocalToS3 and verify createS3CacheOps key prefixing |
| `9a57a41` | feat: integrate S3 caching and per-level cache with placeholder LLM |
| `7deb881` | fix: remove duplicate hash prefix in S3 per-level cache keys |
| `1c0b95f` | docs: update SPEC for per-level caching and S3 singleton |

#### 模块清单

- **s3-client.ts**: S3 客户端核心模块
  - `createS3Client()` - 创建 S3 客户端（支持 minio/tigris 路径样式）
  - `uploadContent()` / `uploadFile()` - 上传字符串/文件
  - `downloadContent()` / `downloadToDirectory()` - 下载内容/文件
  - `fileExists()` / `listFiles()` - 文件存在性检查/列表

- **cache.ts**: 缓存操作模块（per-level 设计）
  - `generateUrlHash()` - URL MD5 哈希
  - `getCachePath()` - per-level 路径（raw/clean/summary .md + .json）
  - `hasLocalCacheLevel()` / `getLocalCacheLevel()` / `saveLocalCacheLevel()` - 本地 per-level 缓存
  - `hasS3CacheLevel()` / `getS3CacheLevel()` / `saveS3CacheLevel()` - S3 per-level 缓存
  - `createS3CacheOps()` - S3 操作封装（以 hash 为 prefix）
  - `deleteLocalCache()` / `getCacheStats()` - 删除/统计

- **types.ts**: 共享类型定义
  - `CrawlMode`, `MODE_LEVELS` - 内容级别与排序常量
  - `CacheLevelMeta`, `CachePath` - per-level 元数据与路径
  - `getEffectiveMode()` - crawl mode 约束逻辑

- **llm.ts**: LLM 调用占位模块（输入原样返回）
  - `callCleanLLM()` / `callSummaryLLM()` - 占位实现
  - `getLLMInfo()` - LLM 配置信息

- **config.ts**: 配置增强
  - `storage.remoteCache` (boolean) - S3 远程缓存开关
  - `storage.s3.bucket` (string) - 数据桶名称
  - `validateConfig()` 新增 remoteCache + bucket 校验

- **index.ts**: 核心集成
  - S3 客户端单例初始化（插件加载时创建一次，按 remoteCache 条件控制）
  - `ensureLevel()` - 分步缓存流程（本地 → S3 → 生成 → 保存 → S3上传）
  - `fetch_web_page` 新增 `mode` 参数（raw/clean/summary）
  - `getEffectiveMode()` - 模式约束降级逻辑
  - 分步进度输出（per-level 消息）

#### 配置文件变更

```jsonc
"storage": {
  "remoteCache": true,            // 新增：S3 远程缓存开关
  "s3": {
    "bucket": "my-bucket"         // 新增：数据桶名称
  }
}
```

#### 缓存结构

```
cacheDir/{hash}/
├── raw.md         raw.json       // { url, uploadedAt }
├── clean.md       clean.json
└── summary.md     summary.json
```

Meta 从汇总的 meta.json 拆分为每个级别独立的 .json 文件，实现逐级缓存判断。

#### 分步处理流程

```
ensureLevel("raw")     → 本地 → S3(remoteCache=true) → 爬取
ensureLevel("clean")   → 本地 → S3(remoteCache=true) → callCleanLLM
ensureLevel("summary") → 本地 → S3(remoteCache=true) → callSummaryLLM
```

#### 单元测试

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| s3-client.test.ts | 31 | 上传/下载/存在检查/列表/Content-Type |
| cache.test.ts | 24 | per-level 本地/S3 缓存、has/get/save、统计 |
| types.test.ts | 6 | MODE_LEVELS 排序与常量值 |
| llm.test.ts | 14 | 占位行为、边界内容、多 config |
| config.test.ts | 35 | resolveApiKey/Prompt、validate、load、remoteCache |
| index.test.ts | 13 | getEffectiveMode 9 种组合全覆盖 |
| **合计** | **123** | |

#### 功能测试记录

| 日期 | 测试内容 | 结果 |
|------|----------|------|
| 2026-05-04 | S3 连接测试（列出文件列表） | ✅ 通过 |
| 2026-05-04 | 下载 demo.jpeg 到本地 | ✅ 通过 |
| 2026-05-04 | 上传 image.png 到 S3 | ✅ 通过 |
| 2026-05-04 | 上传 docs 目录到 S3 | ✅ 通过 |
| 2026-05-04 | 下载云端 docs 目录到本地 | ✅ 通过 |
| 2026-05-05 | 本地缓存保存（raw.md + raw.json） | ✅ 通过 |
| 2026-05-05 | S3 双层目录 Bug 修复验证 | ✅ 通过 |
| 2026-05-05 | 多 mode（raw/clean/summary）抓取不同 URL，本地+S3 缓存 | ✅ 通过 |
| 2026-05-05 | crawl mode=raw 限制下请求 clean 模式 | ✅ 降级为 raw |
| 2026-05-05 | 删除本地缓存后从 S3 恢复 | ✅ 通过 |
| 2026-05-05 | 部分缓存命中（raw 已有，clean 需生成） | ✅ 通过 |
| 2026-05-05 | S3 不可达，errorMode=graceful | ✅ 跳过 S3，仅用本地 |
| 2026-05-05 | S3 不可达，errorMode=strict | ✅ 加载时报错退出 |

---

### v0.2.2 工具精简与健康检查

**状态:** ✅ 已完成

**完成日期:** 2026-05-05

#### 提交记录

| 提交 | 描述 |
|------|------|
| `7305234` | refactor: simplify fetch_web_page parameters, remove f and extract_instruction |
| `46e76c2` | fix: add S3 health check before client creation to prevent hang on unreachable storage |

#### 实现内容

- **index.ts**: 精简 fetch_web_page 参数
  - 移除 `f` 参数 — 恒为 `"fit"`，与 `mode` 语义重复
  - 移除 `extract_instruction` 参数 — execute 从未消费
  - 清理死函数 `formatFetchResult()`
  - `callCrawl4AI()` 内部硬编码 `f: "fit"`

- **s3-client.ts**: 新增健康检查
  - `checkS3Health(endpoint, timeoutMs)` — 调用 RustFS `/health` 端点，AbortController 5s 超时
  - 任何异常（DNS、连接拒绝、超时）返回 `false`

- **index.ts**: S3 初始化改为先探活
  - 扩展入口改为 `async function`
  - 仅 `remoteCache=true` 时执行健康检查
  - healthy → 创建 S3Client，`s3Available=true`
  - unhealthy + strict → 加载时抛错
  - unhealthy + graceful → 打印警告，`s3Available=false`，跳过所有 S3 操作

#### 问题修复

修复前 `createS3Client()` 只构造对象不验证连通性，导致 S3 不可达时请求无限阻塞。修复后最多 5s 即可判定不可达。

---

## 待完成功能

### LLM 实际 API 调用

- [ ] `callCleanLLM()` - 实现 OpenAI/Anthropic API 调用
- [ ] `callSummaryLLM()` - 实现 OpenAI/Anthropic API 调用
- [ ] LLM 错误处理、重试与超时

### 集成测试

- [ ] 端到端测试（SearXNG + Crawl4AI + S3 + LLM）
- [x] S3 remoteCache=true 实际连通性测试（健康检查已覆盖）
- [x] errorMode strict/graceful 行为验证（S3 场景已验证，LLM 场景待 LLM 接入后验证）
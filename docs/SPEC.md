# pi-search-crawl 功能规格

**版本:** v0.2.0  
**状态:** 待实现  
**更新日期:** 2026-05-03

---

## 概述

pi-search-crawl 是 pi-coding-agent 的搜索和网页抓取扩展，提供两个核心工具：

- **`search`**: 使用 SearXNG 元搜索引擎进行隐私、安全的网页搜索
- **`fetch_web_page`**: 使用 Crawl4AI 抓取网页，并通过 LLM 进行清洗和总结

---

## 1. config.json 配置结构

```json
{
  "services": {
    "searxng": {
      "url": "http://localhost:8080"
    },
    "crawl4ai": {
      "url": "http://localhost:11235"
    }
  },
  "crawl": {
    "mode": "summary"
  },
  "llm": {
    "clean": {
      "baseUrl": "http://localhost:11434/v1",
      "endpointType": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "modelName": "qwen2-0.5b-instruct",
      "systemPrompt": {
        "type": "string",
        "value": "You are a content cleaner..."
      }
    },
    "summary": {
      "baseUrl": "https://api.groq.com/openai/v1",
      "endpointType": "openai",
      "apiKey": "${GROQ_API_KEY}",
      "modelName": "gemma-e4b",
      "systemPrompt": {
        "type": "string",
        "value": "Summarize the following content..."
      }
    }
  },
  "storage": {
    "cacheDir": "/path/to/cache",
    "remoteCache": true,
    "s3": {
      "url": "https://rustfs-api.tail38e3f8.ts.net/",
      "accessKey": "${S3_ACCESS_KEY}",
      "secretKey": "${S3_SECRET_KEY}",
      "api": "s3v4",
      "path": "auto",
      "bucket": "my-bucket"
    }
  },
  "errorMode": "strict"
}
```

---

## 2. 配置类型定义

### systemPrompt 配置

```typescript
interface SystemPromptConfig {
  type: "string" | "env" | "file";
  value: string;
}
```

| type | 说明 |
|------|------|
| `string` | 直接使用 value 作为 prompt |
| `env` | value 是环境变量名，读取环境变量的值 |
| `file` | value 是文件路径，读取文件内容作为 prompt |

### LLM 配置

```typescript
interface LLMConfig {
  baseUrl: string;
  endpointType: "openai" | "anthropic";
  apiKey: string;  // 支持 ${ENV_VAR} 语法
  modelName: string;
  systemPrompt: SystemPromptConfig;
}
```

### S3 配置

```typescript
interface S3Config {
  url: string;
  accessKey: string;
  secretKey: string;
  api: "s3v4";
  path: "auto";
  bucket: string;
}
```

### 缓存元数据

每个缓存级别有独立的元数据文件：

```typescript
interface CacheLevelMeta {
  url: string;
  uploadedAt: string;
}
```

### 完整配置

```typescript
interface Config {
  services: {
    searxng: { url: string };
    crawl4ai: { url: string };
  };
  crawl: {
    mode: "raw" | "clean" | "summary";
  };
  llm: {
    clean?: LLMConfig;
    summary?: LLMConfig;
  };
  storage: {
    cacheDir: string;
    remoteCache?: boolean;
    s3?: S3Config;
  };
  errorMode: "strict" | "graceful";
}
```

---

## 3. fetch_web_page 工具参数

```typescript
{
  url: string,                    // URL
  f: "fit" | "raw",              // Crawl4AI filter
  mode: "raw" | "clean" | "summary",  // 内容级别
  timeout: number,               // 超时（秒）
  wordCountThreshold: number     // 最小段落字数
}
```

| 参数 | 类型 | 默认值 | 必填 | 描述 |
|------|------|--------|------|------|
| `url` | string | - | 是 | 要抓取的网页 URL |
| `f` | string | "fit" | 否 | Crawl4AI 内容过滤器 |
| `mode` | string | "clean" | 否 | 请求的内容级别 |
| `timeout` | number | 60 | 否 | 超时时间（秒） |
| `wordCountThreshold` | number | 10 | 否 | 最小段落字数 |

---

## 4. 模式约束逻辑

### 模式级别

```
raw < clean < summary
```

### crawl mode

`crawl mode` 是系统允许的最高级别（人类控制），定义在 config.json 中。

| crawl mode | 允许的模式 | 说明 |
|------------|-----------|------|
| `raw` | raw | 只允许返回原始内容 |
| `clean` | raw, clean | 允许返回原始或清洗后内容 |
| `summary` | raw, clean, summary | 允许所有级别（最高权限） |

### 约束规则

```
请求的 mode > crawl mode → 降级返回 crawl mode 允许的最高级别
```

| 请求的 mode | crawl mode | 实际返回 | 说明 |
|-------------|------------|----------|------|
| summary | summary | summary.md | 正常 |
| summary | clean | clean.md | 降级 |
| summary | raw | raw.md | 降级 |
| clean | clean | clean.md | 正常 |
| clean | raw | raw.md | 降级 |
| raw | any | raw.md | 正常 |

---

## 5. systemPrompt 加载逻辑

```typescript
function resolvePrompt(config: SystemPromptConfig): string {
  switch (config.type) {
    case "string": return config.value;
    case "env": return process.env[config.value] ?? "";
    case "file": return readFileSync(config.value, "utf-8");
  }
}

function resolveApiKey(key: string): string {
  // 支持 ${ENV_VAR} 语法
  const match = key.match(/^\$\{(.+)\}$/);
  if (match) {
    return process.env[match[1]] ?? "";
  }
  return key;
}
```

---

## 6. 完整处理流程

### 分步缓存策略

缓存按 raw → clean → summary 三级逐步检查与生成，每级独立缓存：

```
用户调用 fetch_web_page(url="https://example.com", mode="summary")
    │
    ▼
[0] 计算 effectiveMode（考虑 crawl mode 约束）
    │   若降级 → onUpdate("⚠️ 模式降级: summary → clean")
    │
    ├─ effectiveMode = "raw" ──────────────┐
    ├─ effectiveMode = "clean" ────────────┤
    └─ effectiveMode = "summary" ──────────┘
                    │
    ╔═══════════════▼══════════════════════╗
    ║     Step 1: ensureLevel("raw")      ║
    ╠══════════════════════════════════════╣
    ║ [1.1] 本地检查 {hash}/raw.json      ║
    ║        ├─ 存在 → "📁 raw 缓存命中"   ║
    ║        │         return rawContent   ║
    ║        └─ 不存在                     ║
    ║                                      ║
    ║ [1.2] remoteCache=false → 跳过 S3   ║
    ║        remoteCache=true              ║
    ║        └─ S3 检查 {hash}/raw.json   ║
    ║           ├─ 存在 → "☁️ raw S3 命中"  ║
    ║           │       下载到本地后 return ║
    ║           └─ 不存在                  ║
    ║                                      ║
    ║ [1.3] 爬取网页                       ║
    ║        "🌐 正在爬取..."              ║
    ║        "✅ 爬取完成 (raw.md: {size})" ║
    ║                                      ║
    ║ [1.4] 本地保存 raw.md + raw.json     ║
    ║                                      ║
    ║ [1.5] remoteCache=false → 跳过       ║
    ║        remoteCache=true              ║
    ║        └─ S3 上传 raw.md+raw.json    ║
    ║                                      ║
    ║        return rawContent             ║
    ╚═══════════════╦══════════════════════╝
                    │ rawContent
    ╔═══════════════▼══════════════════════╗
    ║    Step 2: ensureLevel("clean")     ║  ← 仅 effectiveMode ≥ clean
    ╠══════════════════════════════════════╣
    ║ [2.1] 本地检查 {hash}/clean.json    ║
    ║        ├─ 存在 → "📁 clean 缓存命中" ║
    ║        │         return cleanContent ║
    ║        └─ 不存在                     ║
    ║                                      ║
    ║ [2.2] remoteCache=false → 跳过 S3   ║
    ║        remoteCache=true              ║
    ║        └─ S3 检查 {hash}/clean.json ║
    ║           ├─ 存在 → "☁️ clean S3 命中"║
    ║           │       下载到本地后 return ║
    ║           └─ 不存在                  ║
    ║                                      ║
    ║ [2.3] 调用 clean LLM(rawContent)    ║
    ║        "🧹 调用清洗模型 ({model})"   ║
    ║        "✅ 清洗完成 (clean.md: {size})"║
    ║        （LLM 未配置时降级到 raw）    ║
    ║                                      ║
    ║ [2.4] 本地保存 clean.md+clean.json  ║
    ║                                      ║
    ║ [2.5] remoteCache=false → 跳过       ║
    ║        remoteCache=true              ║
    ║        └─ S3 上传 clean.md+clean.json║
    ║                                      ║
    ║        return cleanContent           ║
    ╚═══════════════╦══════════════════════╝
                    │ cleanContent
    ╔═══════════════▼══════════════════════╗
    ║   Step 3: ensureLevel("summary")    ║  ← 仅 effectiveMode = summary
    ╠══════════════════════════════════════╣
    ║ [3.1] 本地检查 {hash}/summary.json  ║
    ║        ├─ 存在 → "📁 summary 缓存命中"║
    ║        │         return summaryContent║
    ║        └─ 不存在                     ║
    ║                                      ║
    ║ [3.2] remoteCache=false → 跳过 S3   ║
    ║        remoteCache=true              ║
    ║        └─ S3 检查 {hash}/summary.json║
    ║           ├─ 存在 → "☁️ summary 命中" ║
    ║           │       下载到本地后 return ║
    ║           └─ 不存在                  ║
    ║                                      ║
    ║ [3.3] 调用 summary LLM(cleanContent)║
    ║        "📝 调用总结模型 ({model})"   ║
    ║        "✅ 总结完成 (summary.md: {size})"║
    ║        （LLM 未配置时降级到 clean）  ║
    ║                                      ║
    ║ [3.4] 本地保存 summary.md+summary.json║
    ║                                      ║
    ║ [3.5] remoteCache=false → 跳过       ║
    ║        remoteCache=true              ║
    ║        └─ S3 上传 summary.md+summary.json║
    ║                                      ║
    ║        return summaryContent         ║
    ╚═══════════════╦══════════════════════╝
                    │
                    ▼
    📋 返回 effectiveMode 对应的最高级别内容
```

### ensureLevel 伪代码

```typescript
async function ensureLevel(level, url, cacheDir, s3Ops, onUpdate, generator) {
  // [1] 检查本地缓存: {hash}/{level}.json
  const local = getLocalCacheLevel(url, cacheDir, level);
  if (local) {
    onUpdate(`📁 ${level} 缓存命中`);
    return local.content;
  }

  // [2] 如果 remoteCache=true，检查 S3 缓存
  if (s3Ops) {
    const s3Cache = await getS3CacheLevel(s3Ops, url, level);
    if (s3Cache) {
      saveLocalCacheLevel(url, cacheDir, level, s3Cache.content);
      onUpdate(`☁️ ${level} S3 缓存命中，已下载到本地`);
      return s3Cache.content;
    }
  }

  // [3] 生成内容
  const content = await generator();

  // [4] 本地保存
  saveLocalCacheLevel(url, cacheDir, level, content);

  // [5] 如果 remoteCache=true，上传 S3
  if (s3Ops) {
    try {
      await saveS3CacheLevel(s3Ops, url, level, content);
    } catch {
      onUpdate(`⚠️ S3 上传 ${level} 失败`);
    }
  }

  return content;
}
```

---

## 7. errorMode 行为

| 场景 | graceful | strict |
|------|----------|--------|
| LLM 不可用 | 降级模式继续，返回可用的最高级别 | 报错 |
| S3 不可用 | 跳过上传，返回本地内容 | 报错 |
| SearXNG 不可用 | 返回友好提示 | 报错 |
| Crawl4AI 不可用 | 返回友好提示 | 报错 |

---

## 8. 插件启动初始化

```typescript
// 插件加载时执行
function initPlugin(config: Config): {
  s3Client: S3Client | null;
  s3Bucket: string | null;
  s3Available: boolean;
} {
  // 1. 校验 crawl mode 与 LLM 配置匹配
  if (config.crawl.mode === "summary") {
    if (!config.llm.summary) {
      throw new Error("crawl.mode='summary' requires llm.summary to be configured");
    }
  }
  if (config.crawl.mode === "clean" || config.crawl.mode === "summary") {
    if (!config.llm.clean) {
      throw new Error("crawl.mode requires llm.clean to be configured");
    }
  }

  // 2. S3 客户端初始化（仅一次，仅当 remoteCache=true）
  let s3Client: S3Client | null = null;
  let s3Bucket: string | null = null;
  let s3Available = false;

  if (config.storage.remoteCache && config.storage.s3) {
    s3Bucket = config.storage.s3.bucket;
    try {
      s3Client = createS3Client(config.storage.s3);
      s3Available = true;
    } catch (e) {
      if (config.errorMode === "strict") {
        throw new Error(`S3 connection failed: ${e.message}`);
      }
      console.warn("⚠️ S3 不可用，将跳过远程缓存");
    }
  }

  return { s3Client, s3Bucket, s3Available };
}
```

**S3 初始化条件：**

| remoteCache | 行为 |
|-------------|------|
| `false` | 不创建 S3 客户端，`s3Available=false`，所有 S3 操作跳过 |
| `true` + S3 可用 | `s3Available=true`，每级缓存本地→S3→生成 |
| `true` + S3 不可用 | graceful 模式跳过 S3，strict 模式报错 |

**LLM 校验规则：**

| crawl mode | 必须配置的 LLM |
|------------|---------------|
| raw | 无 |
| clean | clean LLM |
| summary | clean LLM + summary LLM |

---

## 9. S3 存储结构

S3 是扁平结构（flat namespace），"文件夹"只是 Key 中用 `/` 分隔的前缀。

Bucket 名称由 `config.storage.s3.bucket` 指定。

```
{bucket}/
└── {hash}/
    ├── raw.md         # 原始内容
    ├── raw.json       # { url, uploadedAt }
    ├── clean.md       # 清洗后内容（可选）
    ├── clean.json     # { url, uploadedAt }
    ├── summary.md     # 总结内容（可选）
    └── summary.json   # { url, uploadedAt }
```

**Key 命名规则：**
- `path: "auto"` 时，直接使用 `{hash}` 作为前缀
- hash 值由 URL 生成（MD5 或 SHA256）

**缓存判断规则：**

`{hash}/{level}.json` 存在 → 该级别缓存可用。每个级别的缓存独立判断，互不依赖。

**raw.json / clean.json / summary.json 格式：**

```json
{
  "url": "https://example.com/page",
  "uploadedAt": "2026-05-05T12:00:00Z"
}
```

---

## 10. 缓存逻辑

### 缓存优先级（每级独立）

```
本地缓存 > S3 缓存 > 生成
```

### 单级缓存命中流程（ensureLevel）

```
ensureLevel(level):
  ┌─────────────────────────────────────────────┐
  │ [1] 检查 {hash}/{level}.json 本地          │
  │     ├─ 存在 → 读取 {level}.md，return     │
  │     └─ 不存在                               │
  │                                              │
  │ [2] 如果 remoteCache=true:                   │
  │     └─ 检查 S3 {hash}/{level}.json          │
  │        ├─ 存在 → 下载到本地，return        │
  │        └─ 不存在 → 继续                     │
  │                                              │
  │ [3] 生成内容（爬取 / LLM 调用）            │
  │                                              │
  │ [4] 本地保存 {level}.md + {level}.json     │
  │                                              │
  │ [5] 如果 remoteCache=true:                   │
  │     └─ S3 上传 {level}.md + {level}.json   │
  └─────────────────────────────────────────────┘
```

### 缓存更新流程（每级独立）

1. 生成内容后，保存 `{hash}/{level}.md` + `{hash}/{level}.json` 到本地
2. 若 `remoteCache=true`，上传到 S3
3. 每个级别的缓存互不依赖，可独立存在

---

## 11. 进度输出

`onUpdate` 回调用于实时输出进度信息给用户界面。

### 进度输出示例

```
🔍 [raw] 检查本地缓存...
☁️ [raw] S3 缓存命中，已下载到本地
🔍 [clean] 检查本地缓存...
🧹 调用清洗模型 (qwen2-0.5b-instruct)...
✅ 清洗完成 (clean.md: 8.1 KB)
☁️ 上传 clean 到 S3...
🔍 [summary] 检查本地缓存...
📝 调用总结模型 (gemma-e4b)...
✅ 总结完成 (summary.md: 1.2 KB)
☁️ 上传 summary 到 S3...
📋 返回内容: summary.md
```

### 进度消息列表

| 步骤 | 进度消息 |
|------|----------|
| 检查缓存 | `🔍 [{level}] 检查本地缓存...` |
| 本地命中 | `📁 {level} 缓存命中` |
| S3 命中 | `☁️ [{level}] S3 缓存命中，已下载到本地` |
| 爬取 | `🌐 正在爬取...` |
| 爬取完成 | `✅ 爬取完成 (raw.md: {size})` |
| 清洗 | `🧹 调用清洗模型 ({model})...` |
| 清洗完成 | `✅ 清洗完成 (clean.md: {size})` |
| 总结 | `📝 调用总结模型 ({model})...` |
| 总结完成 | `✅ 总结完成 (summary.md: {size})` |
| S3 上传 | `☁️ 上传 {level} 到 S3...` |
| 返回结果 | `📋 返回内容: {level}.md` |

---

## 12. 文件结构

```
pi-search-crawl/
├── index.ts          # 主逻辑 + S3 单例初始化 + 分步处理流程
├── config.ts        # 配置加载 + 类型定义 + schema 校验
├── types.ts         # 共享类型定义
├── cache.ts         # 缓存操作（per-level）
├── s3-client.ts     # S3 客户端封装
├── llm.ts           # LLM 调用（当前为占位实现）
├── package.json
└── docs/
    ├── README.md
    ├── ARCHITECTURE.md
    └── SPEC.md       # 本文件
```

### config.ts 内容

```typescript
// - Config 类型定义
// - 默认配置
// - config.json 加载逻辑
// - systemPrompt 解析
// - API key 解析
// - Schema 校验
```

### index.ts 内容

```typescript
// - 常量定义
// - S3 客户端单例初始化（插件加载时创建一次）
// - getEffectiveMode（模式约束）
// - ensureLevel（分步缓存检查与生成）
// - LLM 调用函数
// - registerTool: search
// - registerTool: fetch_web_page
// - 插件初始化（加载配置、校验）
```

### types.ts 内容

```typescript
// - CrawlMode, MODE_LEVELS
// - CacheLevelMeta
// - CachePath
// - CacheData
// - ToolResult
// - S3CacheOperations
```

### cache.ts 内容

```typescript
// - generateUrlHash
// - getCachePath
// - hasLocalCacheLevel / getLocalCacheLevel / saveLocalCacheLevel
// - hasS3CacheLevel / getS3CacheLevel / saveS3CacheLevel
// - createS3CacheOps
// - deleteLocalCache / getCacheStats
```

### llm.ts 内容（占位）

```typescript
// - callCleanLLM(config, content) → LLMResult（输入原样返回）
// - callSummaryLLM(config, content) → LLMResult（输入原样返回）
// - getLLMInfo(config)
```

---

## 13. 依赖包

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@sinclair/typebox": "^0.x"
  }
}
```

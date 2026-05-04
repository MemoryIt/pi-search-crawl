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
    "s3": {
      "url": "https://rustfs-api.tail38e3f8.ts.net/",
      "accessKey": "${S3_ACCESS_KEY}",
      "secretKey": "${S3_SECRET_KEY}",
      "api": "s3v4",
      "path": "auto"
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

```
用户调用 fetch_web_page(url="https://example.com", mode="summary")
    │
    ▼
[1] 生成 url_hash
    │
    ▼
[2] 检查本地缓存: cacheDir/{hash}/
    │
    ├─ 存在 → 读取本地文件
    │         ↓
    │    onUpdate("📁 缓存命中，直接返回")
    │         ↓
    │    return result
    │
    └─ 不存在
          ▼
      [3] 检查 storage.s3 配置
          │
          ├─ 未配置 → 跳过 S3
          └─ 已配置 → S3 GetObject {hash}/meta.json
              │
              ├─ 存在 → onUpdate("☁️ S3 缓存命中，下载到本地...")
              │         下载文件到 cacheDir/{hash}/
              │         ↓
              │    onUpdate("✅ 下载完成")
              │         ↓
              │    return result (本地已有)
              │
              └─ 不存在 → 继续下一步
                  │
                  ▼
              [4] 爬取网页
                  │
                  onUpdate("🌐 正在爬取网页...")
                  │
                  const raw = await crawl4ai(url)
                  │
                  onUpdate("✅ 爬取完成 (raw.md: {size} bytes)")
                  │
                  ▼
              [5] 上传到 S3（如已配置）
                  │
                  onUpdate("☁️ 正在上传 raw.md 到 S3...")
                  │
                  await s3.putObject({hash}/raw.md, raw)
                  await s3.putObject({hash}/meta.json, {...})
                  │
                  onUpdate("✅ 上传完成")
                  │
                  ▼
              [6] 检查 mode & crawl mode 约束
                  │
                  ├─ mode = "raw" or 约束为 raw
                  │    ↓
                  │   onUpdate("📋 返回 raw.md")
                  │    ↓
                  │   return raw.md
                  │
                  ├─ mode = "clean" or "summary"
                  │    ↓
                  │   检查 llm.clean 配置
                  │    │
                  │   ├─ 未配置
                  │   │    ↓
                  │   │   errorMode=strict? 报错 : 降级到 raw
                  │   │
                  │   └─ 已配置
                  │        ↓
                  │   [7] 调用 clean LLM
                  │        │
                  │       onUpdate("🧹 正在调用清洗模型...")
                  │       onUpdate("🧹 模型: {modelName}")
                  │        │
                  │       const clean = await callLLM({
                  │         baseUrl, apiKey, model,
                  │         systemPrompt: resolvePrompt(clean.systemPrompt),
                  │         userMessage: raw
                  │       })
                  │        │
                  │       onUpdate("✅ 清洗完成 (clean.md: {size} bytes)")
                  │        │
                  │       上传到 S3（如已配置）
                  │        │
                  │       ├─ mode = "clean" → return clean.md
                  │       │
                  │       └─ mode = "summary"
                  │            ↓
                  │           [8] 调用 summary LLM
                  │                │
                  │               onUpdate("📝 正在调用总结模型...")
                  │               onUpdate("📝 模型: {modelName}")
                  │                │
                  │               const summary = await callLLM({
                  │                 baseUrl, apiKey, model,
                  │                 systemPrompt: resolvePrompt(summary.systemPrompt),
                  │                 userMessage: clean
                  │               })
                  │                │
                  │               onUpdate("✅ 总结完成 (summary.md: {size} bytes)")
                  │                │
                  │               上传到 S3（如已配置）
                  │                │
                  │               return summary.md
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

## 8. 插件启动校验

```typescript
// 插件加载时执行
function validateConfig(config: Config): void {
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

  // 2. 校验 S3 连通性（如果配置了）
  if (config.storage.s3) {
    const s3 = createS3Client(config.storage.s3);
    try {
      await s3.listBuckets();
    } catch (e) {
      if (config.errorMode === "strict") {
        throw new Error(`S3 connection failed: ${e.message}`);
      }
      console.warn(`⚠️ S3 不可用，将跳过远程缓存`);
    }
  }
}
```

**校验规则：**

| crawl mode | 必须配置的 LLM |
|------------|---------------|
| raw | 无 |
| clean | clean LLM |
| summary | clean LLM + summary LLM |

---

## 9. S3 存储结构

S3 是扁平结构（flat namespace），"文件夹"只是 Key 中用 `/` 分隔的前缀。

```
Bucket/
└── {hash}/
    ├── raw.md      # 原始内容
    ├── clean.md    # 清洗后内容（可选）
    ├── summary.md  # 总结内容（可选）
    └── meta.json   # 元数据
```

**Key 命名规则：**
- `path: "auto"` 时，直接使用 `{hash}` 作为前缀
- hash 值由 URL 生成（MD5 或 SHA256）

**meta.json 格式：**

```json
{
  "url": "https://example.com/page",
  "crawledAt": "2026-05-03T12:00:00Z",
  "crawlMode": "summary",
  "rawSize": 12345,
  "cleanSize": 6789,
  "summarySize": 1234
}
```

---

## 10. 缓存逻辑

### 缓存优先级

```
本地缓存 > S3 缓存 > 重新爬取
```

### 缓存命中流程

1. 检查 `cacheDir/{hash}/` 是否存在本地文件
2. 若本地缓存存在，直接读取并返回
3. 若本地不存在，检查 S3 是否配置
4. 若 S3 已配置，尝试从 S3 下载 `{hash}/meta.json`
5. 若 S3 缓存命中，下载整个目录到本地，然后返回
6. 若 S3 也未命中，则重新爬取

### 缓存更新流程

1. 爬取完成后，保存到本地 `cacheDir/{hash}/`
2. 若 S3 已配置，上传文件到 S3
3. 上传完成后，更新 meta.json

---

## 11. 进度输出

`onUpdate` 回调用于实时输出进度信息给用户界面。

### 进度输出示例

```
🔍 检查本地缓存...
⚠️ 本地缓存未命中
☁️ S3 缓存未命中
🌐 正在爬取网页...
✅ 爬取完成 (raw.md: 15.2 KB)
☁️ 正在上传 raw.md 到 S3...
☁️ 上传 [1/4] raw.md...
✅ 上传完成
🧹 正在调用清洗模型...
🧹 模型: qwen2-0.5b-instruct
✅ 清洗完成 (clean.md: 8.1 KB)
☁️ 正在上传 clean.md 到 S3...
✅ 上传完成
📝 正在调用总结模型...
📝 模型: gemma-e4b
✅ 总结完成 (summary.md: 1.2 KB)
☁️ 正在上传 summary.md 到 S3...
✅ 上传完成

═══════════════════════════
📋 返回内容: summary.md
═══════════════════════════
```

### 进度消息列表

| 步骤 | 进度消息 |
|------|----------|
| 检查缓存 | `🔍 检查本地缓存...` |
| 本地命中 | `📁 缓存命中，直接返回` |
| S3 命中 | `☁️ S3 缓存命中，下载到本地...` |
| 下载完成 | `✅ 下载完成` |
| 爬取 | `🌐 正在爬取网页...` |
| 爬取完成 | `✅ 爬取完成 (raw.md: {size})` |
| 上传到 S3 | `☁️ 正在上传 raw.md 到 S3...` |
| 上传完成 | `✅ 上传完成` |
| 调用清洗模型 | `🧹 正在调用清洗模型...` |
| 清洗完成 | `✅ 清洗完成 (clean.md: {size})` |
| 调用总结模型 | `📝 正在调用总结模型...` |
| 总结完成 | `✅ 总结完成 (summary.md: {size})` |
| 返回结果 | `📋 返回内容: {mode}.md` |

---

## 12. 文件结构

```
pi-search-crawl/
├── index.ts          # 主逻辑
├── config.ts        # 配置加载 + 类型定义 + schema 校验
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
// - 插件启动校验
```

### index.ts 内容

```typescript
// - 常量定义
// - S3 客户端创建
// - LLM 调用函数
// - 缓存操作函数
// - 处理流程函数（含进度输出）
// - registerTool: search
// - registerTool: fetch_web_page
// - 插件初始化（加载配置、校验）
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

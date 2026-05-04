# pi-search-crawl 开发进度

**更新日期:** 2026-05-04

---

## 版本记录

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

## 待完成功能

### S3 存储 (v0.2.0)

- [ ] S3Config 类型定义
- [ ] S3 客户端创建
- [ ] 上传/下载逻辑
- [ ] 缓存同步

### LLM 清洗/总结 (v0.2.0)

- [ ] LLM 调用函数 (clean LLM)
- [ ] LLM 调用函数 (summary LLM)
- [ ] 模式约束逻辑

### 缓存系统 (v0.2.0)

- [ ] 本地缓存逻辑
- [ ] 多级缓存优先级
- [ ] meta.json 管理

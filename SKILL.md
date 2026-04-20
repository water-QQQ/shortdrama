---
name: agnes-short-drama
description: >-
  Structures user ideas into short-drama bible, episode beats, and per-shot prompts,
  then submits one Agnes Claw video task per shot (5–20s each) via the same AIGC API
  as agnes-aigc. Use when the user wants multi-scene short drama, episodic story,
  vertical drama clips, or serialized narrative video—not a single one-off video prompt.
---

# Agnes 短剧生成 Skill

用于「多镜短剧」：先产出可执行的分镜与提示词，再按镜调用 Agnes Claw 视频接口逐段生成。单条 prompt 只要一段视频时请用 `agnes-aigc`。

## Trigger when

- 用户要短剧、分镜、多集/多段剧情视频、竖屏连载感内容
- 需要先定人设与世界观，再分段出片
- 明确需要多段视频（每段对应一镜或一小场）

## Do not use when

- 只要一张图或一条视频、无分镜结构 → `agnes-aigc`
- 只要调研报告打底、不写分镜 → `agnes-research`（可与本 skill 组合：先 research 再短剧）
- PPT / 表格 → `agnes-ppt` / `agnes-sheet`

## 剧情设计（Agent 必须先完成）

按顺序产出下列结构（可写在回复里或 JSON，用户确认后再调接口）。

### 1. Bible（世界观一页纸）

- 题材、受众、基调（喜剧 / 悬疑 / 甜宠等）
- 主角动机、核心冲突、钩子规则（每集结尾留扣）

### 2. Episode beat sheet（本集）

- 8～15 个 beat：起承转合 + 反转/钩子
- 每个 beat 一句话，标序号

### 3. Shot list（对接生成，必填）

每一镜一行/一条对象，字段建议：

| 字段 | 说明 |
|------|------|
| `scene_id` | 稳定编号，如 `E01-S03` |
| `duration` | 秒，**5～20**（Claw 接口限制） |
| `ratio` | 默认竖屏短剧 `9:16`；横屏可用 `16:9` |
| `visual_prompt` | 画面与运镜为主，叙事清晰；不必堆叠空洞「电影级」套话（服务端会做 text/image enhancer） |
| `narrative_note` | 可选，本镜在剧情中的作用 |
| `images` | 可选，参考图 URI 列表；有图则走图生视频 |

**约束**

- 一镜 = 一次 `POST /api/v1/claw/tasks/aigc`，不要试图用一条 prompt 塞满整集。
- 需要角色一致性的镜头再带 `images`，避免每镜都传同一组图浪费积分。

## 视频生成执行

### 方式 A：逐镜调用 `agnes-aigc/scripts/run.ts`

对 shot list 每一镜执行一次，payload 与 `agnes-aigc` 一致，例如：

```json
{
  "content_type": "video",
  "prompt": "[该镜 visual_prompt]",
  "ratio": "9:16",
  "duration": 10,
  "enable_translation": true
}
```

有参考图时带上 `images` 字符串数组。

### 方式 B：批量脚本（推荐多镜）

在本目录执行：

```bash
cd src/claw/skills/agnes-short-drama
npx tsx scripts/run_batch.ts '<JSON>'
```

或 stdin 传入 JSON。载荷见下节。

### 环境变量

与 `agnes-aigc` 相同：

| 变量 | 必填 | 说明 |
|------|------|------|
| `AGNES_BASE_URL` | 是 | Agnes 后端根 URL |
| `AGNES_API_KEY` | 是 | 实例 API Key |
| `AGNES_POLL_TIMEOUT_MS` | 否 | 单镜轮询最长等待；`0` 不轮询 |
| `AGNES_POLL_INTERVAL_MS` | 否 | 轮询间隔 ms，默认 `1000` |

批量时：**每一镜**在 `sequential: true` 时会顺序轮询到完成/失败或超时；`false` 时仅提交并可选短轮询（与单镜逻辑一致）。

## `run_batch.ts` 输入格式

```json
{
  "sequential": false,
  "scenes": [
    {
      "prompt": "镜头内容描述…",
      "ratio": "9:16",
      "duration": 8,
      "images": [],
      "model": null,
      "seed": null,
      "fps": null,
      "enable_translation": true,
      "task_id": null
    }
  ]
}

- `scenes`：必填，至少一项；每项字段语义同 `agnes-aigc` 的 JSON 输入。
- `sequential`：默认 `false`。`true` 时按数组顺序提交并（在配置了 poll 时）顺序等待，减轻瞬时并发压力。

## 返回格式（run_batch）

```json
{
  "skill": "agnes-short-drama",
  "status": "pending | completed | failed | partial",
  "message": "摘要",
  "scenes": [
    {
      "index": 0,
      "task_id": "uuid",
      "status": "pending | completed | failed",
      "message": "",
      "error": "仅失败时",
      "raw": {}
    }
  ]
}
```

`partial` 表示部分镜失败，需根据 `scenes[].error` 处理。

## 对用户话术

与 `agnes-aigc` 一致：用自然口吻说明「在按镜生成短剧片段」，不要主动提 `task_id`、webhook、轮询。积分不足时，将接口返回的 `error` **原文**（含完整 `https://...`）转给用户。

## 失败处理

- 鉴权 / 网络 / 参数错误：同 `agnes-aigc` 的 Failure handling
- 某一镜失败：记录 `scene_id` 与用户说明可单独重试该镜

## 与后端代码的关系（供维护者）

- 任务入口：`POST /api/v1/claw/tasks/aigc`（`ClawAIGCRequest`）
- Worker：`run_claw_aigc_worker` → `ClawAIGCService` → `AIGCUtil.generate_video`
- 本 skill **不**绕过上述链路，以保证积分与任务状态一致

## Additional resources

- 分镜长例与 JSON 样例：[reference.md](reference.md)

# 短剧 Skill 参考

## Shot list JSON 示例（节选）

```json
{
  "episode": "E01",
  "shots": [
    {
      "scene_id": "E01-S01",
      "duration": 8,
      "ratio": "9:16",
      "narrative_note": "开场：女主加班，窗外雨夜",
      "visual_prompt": "Vertical 9:16, young woman at desk, laptop glow on face, heavy rain on window behind her, shallow depth of field, slow push-in, melancholic blue tone, cinematic natural lighting"
    },
    {
      "scene_id": "E01-S02",
      "duration": 10,
      "ratio": "9:16",
      "narrative_note": "手机亮起，神秘消息",
      "visual_prompt": "Close-up smartphone on desk lighting up in dark room, notification blur, finger hesitates then taps, subtle handheld micro-shake, warm screen light vs cool ambient"
    }
  ]
}
```

将每条 `visual_prompt`（及可选 `images`）映射为 `run_batch.ts` 的 `scenes[]` 元素即可。

## run_batch 最小示例

```json
{
  "sequential": true,
  "scenes": [
    { "prompt": "9:16 vertical, office night, woman alone at laptop, rain on window, slow dolly in", "ratio": "9:16", "duration": 8 },
    { "prompt": "9:16 close-up phone screen glow, dark desk, finger taps notification", "ratio": "9:16", "duration": 8 }
  ]
}
```

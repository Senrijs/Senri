<!--
PR のタイトルは英語の Conventional Commits の形で(例: `feat(router): add wildcard routes`)。スカッシュマージなので、そのまま main のコミットと CHANGELOG になります。
Use an English Conventional Commits title (e.g. `feat(router): add wildcard routes`). It becomes the commit on main and the CHANGELOG entry.
-->

## 何を・なぜ / What and why



## 関連する Issue / Related issues

<!-- 例: Closes #123 -->

## 確認 / Checklist

- [ ] `bun test`・`bun run test:node`・`bun run typecheck`・`bun run smoke` が通る / pass
- [ ] 新しい機能や修正にテストを付けた / Added tests for new features or fixes
- [ ] `ui/` を変えたなら `bun run build:pages` の結果も含めた / Included `bun run build:pages` output if `ui/` changed
- [ ] 公開の API や挙動を変えるなら、先に Issue で相談した / Discussed in an issue first if this changes public APIs or behavior
- [ ] 性能に関わるなら、`bench/` の前後の数字と条件を書いた / Added before/after `bench/` numbers and conditions if performance-related

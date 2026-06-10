# .aof/ — AOF v2.0 Runtime State

このディレクトリは [AI Organization Framework v2.0.0](https://github.com/popcoondev/ai-organization-framework/tree/v2.0.0) の **managed-project** topology に沿った運用状態です。Pixel Showcase Engine(product)を Council of Three(Visionary / Builder / Guardian, majority-with-guardian-veto)で統治します。

## AI が最初に読む packet
- [`project-bootstrap.json`](project-bootstrap.json)
- [`context/active/project-orientation.json`](context/active/project-orientation.json)
- [`goals/north-star.json`](goals/north-star.json) / [`operating-goal.json`](goals/operating-goal.json) / [`next-value-slice.json`](goals/next-value-slice.json)
- [`tasks/open/`](tasks/open/)
- [`context/active/recent-confirmation-window.json`](context/active/recent-confirmation-window.json)

## 直近の決定
- [`decisions/DR-2026-001-next-priorities.md`](decisions/DR-2026-001-next-priorities.md) — 次の改善優先順位(Council of Three の集約)
- [`sessions/SESS-2026-0611-COUNCIL.json`](sessions/SESS-2026-0611-COUNCIL.json)

## 境界 (managed-project)
product `main` は human-governed。cadence 自動化が `.aof/` を main に直接書き込むことは禁止。本配置は human maintainer (popcoondev) の明示指示による。

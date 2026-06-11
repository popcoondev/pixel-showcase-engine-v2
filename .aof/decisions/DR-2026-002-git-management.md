# Decision Record: DR-2026-002 — git 管理ルール

- Record Format Version: 1
- Created At: 2026-06-11
- Topology: managed-project (AOF v2.0.0)
- Governance: council-of-three / majority-with-guardian-veto
- Status: Adopted
- Human Maintainer: popcoondev
- Policy Artifact: `.aof/policies.yaml`

---

## 1. Request Framing (Need / Intent / Context)

**Need**
今後の git 運用ルールを orchestrator + Council of Three で定め、属人的・場当たり的な操作を排する。

**Intent**
- 価値の流れ(タグ=value slice)を保ちつつ、可逆性と安全性を担保する。
- AI(orchestrator/Builder)が踏み越えてはいけない git 操作を明文化する。
- public repo の秘密情報・大容量バイナリ混入を防ぐ。

**Context(直接の契機 = 実際の事故)**
orchestrator が検証用一時ファイルの「片付け」で `git checkout -- .` を実行し、**コミット前の tracked ファイル編集(Viewport.tsx の DRACO 対応)を無通知で消失**させた(再適用で復旧)。ルールなき AI の破壊的 git 実行が現実のリスクであることが露呈した。

---

## 2. 各ロールの判断

### Visionary(価値・ビジョン)
- 履歴は「プロダクトが何を実現しようとしたか」の記録。手続きで価値提供を遅くしない。
- conventional-commits prefix で「ユーザーに見える変化 / 内部作業」を区別。1意図=1コミット。
- **タグ = ユーザーが体験できる価値の節目**にのみ。SemVer Minor を「体験の向上」と読み替え。.aof/CI/リファクタのみはタグなし。
- **過剰統制を警告**: PR必須/レビュー承認ゲート、commit-lint で push を止める、ブランチ命名の厳格化、CHANGELOG 自動生成ツール — ソロ運用では価値を遅くするので不採用。
- 最重要: 「体験が変わった時だけタグを打ち、何が変わったかを1文で書く」。

### Builder(実務ワークフロー)
- ソロ+AI では「人間が意図しない変更が静かに消える」が最大リスク。「戻せる・確認できる・AI が踏み越えられない」で設計。
- main 直 push 維持。破壊的/実験は `feat/<slug>`。作業前に `git status` で未追跡/変更を人間に確認。build green 単位でコミット、直後に push。`git stash` は使わない。
- コミット規約: `<type>(<scope>): 要約 [TASK-XXX]` + Co-Authored-By。
- 検証アセットは `.gitignore` 済み専用ディレクトリに限定、終わったら **個別 `rm`**。`checkout -- .`/`clean -f` は使わない。
- AOF 連動: コミットに `[TASK-XXX]`、done 化は build green + push 後、DR は独立 `chore(aof):` コミット。
- 最重要: 「AI が使える git は status/diff/log/add/commit/push/rm<指定> のみ。checkout--./reset--hard/clean-f は AI 禁止」。

### Guardian(リスク・可逆性・保全 / veto)
- 「main 直 push・単一ブランチ・AI が git 直接実行」の三重高リスク。事故はその必然。
- **VETO(AI 実行不可)**: `git checkout -- <path>`/`reset --hard`/`clean -fd`/`push --force`(main)/`rebase`・`amend`(公開履歴)/`filter-branch`。条件付き: `reset --soft`(human が明示)/`stash`(drop/clear は禁止)。
- リスクルール: 破壊的操作は human 承認必須、commit 前に status/diff--stat 報告、作業単位で WIP コミット、**`git add .`/`-A` を避け対象指定**、push 前に差分確認、コンフリクト単独解決を AI 禁止。
- 混入防止: 秘密情報(.env/*.pem/*.key/credentials)・大容量/ユーザーデータの .gitignore、GitHub push protection 有効化。
- main 保護 + .aof 境界: タグは human のみ、**cadence 自動化が .aof を main に直接書くのは VETO**、.aof 変更は独立コミット。
- 最重要: 「`checkout -- <path>`/`reset --hard`/`clean -fd`/`push --force` を human 承認なしに AI は絶対実行しない」。

---

## 3. 一致点 / 衝突点

**一致点**
- **破壊的 git コマンドは human 承認なしに AI 実行しない** — Builder と Guardian の最重要ルールが完全一致。本 DR の中核。
- main 直 push を維持(PR 必須にしない)。破壊的/実験は feature ブランチ。
- conventional-commits + `[TASK-XXX]` + Co-Authored-By。1意図=1コミット。
- build green を commit/push の前提。CI は TASK-002 で導入。
- 検証アセットは ignored 専用ディレクトリ + 個別 rm。
- **タグ = value slice / ユーザー体験の節目**。内部作業はタグなし。
- .aof/ は product コードと別コミット、cadence 自動の main 直書きは禁止。

**衝突点と裁定(orchestrator)**
1. **`git add -A` の可否**: Guardian は秘密混入リスクで対象指定を要求 ↔ Visionary は過剰統制を警告。
   → **裁定**: 全面禁止にはしない。`.gitignore` で秘密/一時物を遮断し、**commit 前に `git status`+`git diff --stat` を確認**したうえでなら `git add -A` 可。スコープ add を優先。Guardian の意図(誤混入防止)はレビュー+ignore で充足。
2. **binary 一括 .gitignore**: Guardian は `*.glb/*.png/*.wasm` 等の ignore を提案 ↔ 本プロジェクトは `public/draco/*.wasm`(必須)や将来の `public/samples/`(ONBOARD/THUMB)を**正当にコミット**する必要。
   → **裁定**: binary 一括 ignore は**不採用**(正規アセットを壊す)。代わりに「ユーザーデータ/大容量は `public/tmp/`(ignored)か作業ディレクトリ外、正規アセットは designated dir に限定」+ secret 系のみ ignore + GitHub push protection で代替。
3. **push タイミング**: Builder「コミット直後に即 push」↔ Guardian「green + human 指示後」。
   → **裁定**: human の commit 指示を起点に「build green → commit → push」を一連で実施(現行運用と整合)。AI 自律 push はしない。
4. **コミット prefix の AOF**: Visionary/Builder `chore(aof):` ↔ Guardian `AOF:`。
   → **裁定**: conventional-commits 準拠の **`chore(aof):`** に統一。
5. **タグ打鍵者**: Guardian「human のみ」。
   → **採用**: タグ/Release は human の判断で打つ(AI は提案まで)。
6. **GitHub branch protection**: Guardian 推奨だが、アカウント本人の token を使う solo 運用では自己ブロックになりうる。
   → **裁定**: ハードな protection は任意(human 判断)。behavioral rule(AI は指示時のみ push、破壊的操作禁止)で実効を担保。**secret scanning / push protection は有効化推奨**。

Guardian の veto(破壊的コマンド・cadence の main 直書き)はいずれも採択。majority で他項目を確定。

---

## 4. 確定した git 管理ルール(要点)

機械可読は `.aof/policies.yaml`。要点:

1. **AI が実行してよい git は `status / diff / log / add<指定> / commit / push(指示時) / rm<指定> / mv` のみ。**
2. **`git checkout -- <path>` / `reset --hard` / `clean -fd` / `push --force` / 公開履歴の `rebase`・`amend` は human の明示承認なしに AI 実行禁止。** 片付けは対象ファイルの `rm` に限定。
3. commit 前に `npm run build` green、`git status` + `git diff --stat` を確認・報告。
4. コミット規約 `<type>(<scope>): 要約 [TASK-XXX]` + `Co-Authored-By`。1意図=1コミット。.aof/ は `chore(aof):` で product と別コミット。
5. main 直 push 維持。破壊的/実験は `feat/<slug>`。AI は human 指示時のみ push、自律 push しない。
6. タグ = value slice / ユーザー体験の節目(`vX.Y.0` + Release に What's New 1段落)。内部作業はタグなし。打鍵は human。
7. 秘密情報・ユーザーデータ・大容量バイナリをコミットしない(.gitignore 強化 + designated dir + GitHub push protection)。
8. cadence 自動化が `.aof/` を main に直接 commit/push することは禁止(managed-project 境界)。

---

## 5. 次に誰が何をやるか

| 担当 | アクション |
|------|-----------|
| **Builder (= Claude Code)** | 本ルールに即時準拠(本 DR コミットから dogfood: status 確認 → スコープ add → .aof は別コミット)。 |
| **Guardian** | TASK-002 の CI に「build green ゲート」を組み込み、ルールを自動化。 |
| **Human (popcoondev)** | GitHub の secret scanning / push protection を有効化(任意で branch protection)。タグ/Release の打鍵を担う。 |

---

## Project Note
managed-project topology。本 DR と `.aof/` 配置・更新は human maintainer の明示指示による。cadence 自動化の main 直書きは禁止。

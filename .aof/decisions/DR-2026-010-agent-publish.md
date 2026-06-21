# Decision Record: DR-2026-010 — エージェントからの公開(publish / `/s/`)

- Record Format Version: 1
- Created At: 2026-06-21
- Framework: AOF v3.5.0
- Governance: councils / 2_of_3(対外**公開**サーフェス=Operations/Guardian の安全審査、Guardian veto 水準)
- Builds on: DR-2026-009(エージェント編集API + MCP ゲートウェイ。**§3.4 で「公開しない」と明示**)
- Status: **Adopted**(2026-06-21 human が **C=人間承認トークン付き公開** をラチファイ)
- Human Maintainer: popcoondev

> **採用: C**。発行と公開を App Check で分離する:
> `issuePublishToken` は **App Check enforce**(ブラウザ=人間のみ発行可、MCP は App Check 無しで弾かれる)、
> `publishScene(token)` は App Check exempt(トークンを持つエージェントが公開実行)。トークンは
> `users/{uid}/publishApprovals/{token}` doc(sceneId・exp≤10分・consumed)で Firestore を真実とする(署名鍵不要)。

---

## 1. Framing (Need / Intent / Context)

**Need**: エージェントが「作る→動かす→見せる」までは MCP で完結するようになった(配置/動き/環境/シーン変換/視点ツアー/実寸計測/取り込み)。残る最後のピースが **公開(`showcases/` 昇格 = `/s/{id}` 公開URL)**。

**Intent**: 「下書きが整ったら公開まで」をエージェント経路に乗せたい。ただし公開は他の編集操作と**リスクの質が違う**(下記)。

**Context**: DR-2026-009 は編集を「作業コピーのみ・公開しない」と線引きした。本DRはその線を動かすか/どう動かすかの専用判断。`publishToCloud`(クライアント実装)は既に存在し、Shot 必須・サムネ生成・利用規約同意・`ownerId` 記録・上書き更新を行う。

---

## 2. リスク(公開固有)

- **対外公開**: インターネットに出る。不適切コンテンツ/スパム、モデレーション・削除依頼の責任が発生。
- **不可逆性**: 一度出ると外部にキャッシュ/インデックスされ得る(削除しても残る可能性)。
- **無人公開**: エージェントが人間のチェック無しに世へ出せてしまう。
- **同意の所在**: 既存 publish は利用規約同意(`termsAgreedAt`)を human が画面で行う。エージェント公開ではこの同意主体が曖昧になる。
- **App Check / レート**: 公開書き込みの悪用対策(個数・頻度上限)を別途設計する必要。

---

## 3. 選択肢

- **A. 公開はエージェント不可(現状維持)**: 公開は human が UI(☁開く → Publish)で行う。エージェントは「下書き完成」までで、人間に「シーンXを開いて Publish して」と促す。最も安全・追加実装ゼロ。Intent は部分達成。
- **B. ステージのみ(下書き準備 + 人間が最終公開)**: エージェントは公開候補をマーク/整える(例: `markPublishReady`)。実公開は human が UI で確定。**同意・最終判断は常に人間**。
- **C. 人間承認トークン付きで公開(推奨)**: エージェントは `publishScene(sceneId, approvalToken)` を呼べるが、`approvalToken` は **human が UI/CLI で都度発行**した使い捨て(対象 sceneId・短時間有効)。無人連打を防ぎつつ、承認1回で公開まで MCP 完結。`termsAgreedAt` はトークン発行=human 同意とみなす。
- **D. レート上限付きで自由公開**: human 承認なしに公開可(個数/頻度上限 + 簡易チェック)。最も便利だが**無人で対外公開**=Guardian veto 水準のリスク。非推奨。

---

## 4. 推奨決定(ドラフト)

**C を推奨**。理由: プロジェクトの既存規範「publish/release = human 承認」を満たしつつ、エージェント完結性も確保できる中庸。承認は per-sceneId・短時間・使い捨てトークンで、無人公開(D)を排除。A/B より Intent 達成度が高く、D より安全。

---

## 5. Guardian 条件(C 採用時)

1. **承認トークン必須**: `publishScene` は human 発行の approvalToken 無しでは `permission-denied`。トークンは {uid, sceneId, exp(≤10分), nonce} を署名したもの。1回使い切り(nonce 消費)。
2. **uid 自損**: 公開できるのは呼び出し元 uid 自身の `showcases/{sceneId}` のみ。`ownerId` は uid 固定。
3. **同意の記録**: トークン発行時刻=`termsAgreedAt` として記録(human が発行UI で規約に同意)。
4. **レート上限**: 1日あたり公開回数上限(例 20)+ アカウント公開総数上限。`aiPubCount`/`aiPubDate` で日次リセット。
5. **取り消し(unpublish)**: エージェントからも `unpublishScene(sceneId)`(自損)を提供。公開停止は承認不要(安全側)。
6. **App Check**: 公開 callable の非enforce はこの1本のみ。クライアント強制は温存。
7. **デプロイ/トークン鍵は human**: 署名鍵はリポジトリに置かない。Functions デプロイは human。cadence 自動デプロイ禁止。
8. **撤回条項**: 悪用兆候(スパム公開等)が出たら本DRは即時 A に差し戻し可能(Operations 判断)。

---

## 6. 実装スライス(C 採用時 / TASK-049)

- スライス1: `issuePublishToken`(human 用。UI ボタン or CLI)= 対象 sceneId の使い捨て署名トークンを発行。
- スライス2: `publishScene(sceneId, approvalToken)` callable = トークン検証 → `composeSceneServer` 相当でスナップショット作成 → `showcases/{id}` 昇格 + サムネ。`unpublishScene(sceneId)`。
- スライス3: MCP ツール `publish_scene` / `unpublish_scene`。`publish_scene` は approvalToken 引数必須(human から渡す)。
- 既存 `publishToCloud`(UI 経路)は残置。

---

## 7. 未決(human ラチファイ事項)

- **ポリシー選択 A / B / C / D**(推奨 C)。
- C の場合: トークン有効期限(既定10分)、1日公開上限(既定20)、発行 UI の形(ボタン / コピペトークン)。

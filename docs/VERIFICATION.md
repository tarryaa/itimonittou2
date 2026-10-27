# 検証記録

2026-10-27。新規プロジェクトの公開先リポジトリ: https://github.com/tarryaa/itimonittou2

## 確認済み

- TypeScript型検査、本番ビルド、配信9ファイルのキャッシュ世代生成。
- 教材・フィルタ・IndexedDB・バックアップの単体テスト31件成功。
- Playwrightの390pxモバイル画面で **17件成功、1件スキップ**。Chromium/WebKitの両方で操作を検証。WebKitのService Workerライフサイクルテスト1件は意図的にスキップし、Chromiumで検証。
- 1,496問全件の表示、横スクロールなし、独立赤字切替、全解答の正しいID対応、ポップアップの画面内配置。
- 一括表示/非表示、通常時の遠距離スクロール自動非表示、一括表示中の表示維持、再読み込み時の非表示。
- 間違いの1回単位の追加/取消、日本時間表示、保存・再読み込み、回数変更時の位置維持。
- 複合絞り込みと相対位置保持、注意マークの条件包含、絞り込み解除、現在の問題が除外された際の元の順序で最も近い問題への移動。最終修正後にChromium/WebKitで再検証。
- 編集内容と原文の分離、編集保存と履歴維持、赤字→空欄→赤字の変換・解答対応。
- 全データのJSONダウンロード、不正バックアップ拒否、復元プレビュー、確定復元・復元前データへの回復。復元処理の連打防止と保存順序を修正後に両ブラウザで再検証。
- 本番サブパス `/itimonittou/` でmanifest/start_url/scope/静的ファイルを読み込み。リポジトリ名を含む固定パスはアプリに埋め込まず、実際の `/itimonittou2/` にも相対パスで対応。
- ChromiumでService Workerの完全事前キャッシュ、オフライン再読み込み、学習記録維持、更新版の待機、保存後の更新と旧キャッシュ削除、更新後のオフライン起動。
- 教材の全2,092空欄の解答双方向参照、原本非改変、章/枝問順、図表の正確な所属、教材追加と競合保持、復元の整合性、DBの分離保存。
- 添付ファイルと `public/data/original.json` のSHA-256一致:
  `50b810652c09f4324b301d1f25700354773ac7536573013b13683c14af855a3b`

## GitHub Pages公開の状況

ソースはmainへpush済み。GitHub Actions上の依存導入・単体テスト・本番ビルドは成功。Pagesが未有効のためconfigure-pagesで停止した。自動有効化も試したがGitHub APIが `Resource not accessible by integration (403)` を返した。

リポジトリ管理者が https://github.com/tarryaa/itimonittou2/settings/pages で **Source → GitHub Actions** に設定する必要がある。設定後、[Actions](https://github.com/tarryaa/itimonittou2/actions) から最新ワークフローを再実行すると、テスト・ビルド後にdeployを行う。

公開予定: https://tarryaa.github.io/itimonittou2/

この記録時点ではHTTP 404で、公開済みとは扱っていない。

## 未検証・元データの制限

- iPhone実機Safari、実機ホーム画面追加・アイコン起動、実機完全終了後の再起動。Playwright WebKitは実機Safariそのものではない。
- 公開サイトでのHTTP成功、全ファイル取得、実際のPages環境でのキャッシュ更新。Pages設定後に検証が必要。
- 原書画像との教材照合。教材原本は未校正ドラフトで `ready_for_production:false`。98・99ページ未収録、125ページ本文なし、9図表の詳細不足。原本を推測で補正していない。
- 長期間のiOSによるストレージ保持、低メモリ端末での長時間学習。端末のブラウザデータ削除ではIndexedDBも消えるため、バックアップ機能を用意している。

実行環境のWebKit不足ライブラリはユーザー領域に配置して検証した。通常のCI環境は `npx playwright install --with-deps chromium webkit` で準備する。

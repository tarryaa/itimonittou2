# GitHub PagesとiPhoneでの利用

対象リポジトリ: https://github.com/tarryaa/itimonittou2

公開URL: https://tarryaa.github.io/itimonittou2/

GitHub Actionsによる初回デプロイ成功とHTTP 200を確認済みです。実際のブラウザ検証と更新の結果は[検証記録](VERIFICATION.md)を参照してください。

## GitHub側の設定

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
2. **Actions → Test and deploy GitHub Pages → Run workflow** を実行する。mainへのpushでも実行する。
3. buildとdeployの成功を確認し、deployのEnvironment URLを開く。
4. GitHub Actionsの実行が制限されている場合は **Settings → Actions → General** で、このリポジトリ内のActionsと使用している公式Actionsを許可する。

初回設定時、API接続でPages設定を操作すると `Resource not accessible by integration (403)` が返されたため、ユーザーがSourceをGitHub Actionsに設定しました。現在の設定は完了しています。ソースへの書き込み権限とPages設定変更権限は別です。

## ローカル確認

```sh
npm ci
npm test -- --run
npm run build
npm run preview -- --host 0.0.0.0
```

`npm run build` は `tsc -b && vite build && node scripts/build-sw.mjs` を実行する。生成スクリプトは配信ファイルすべてのハッシュからキャッシュ世代を作成し、教材JSON・JS・CSS・アイコン・manifest・HTMLの完全な事前キャッシュ一覧を生成する。

Viteのbase、manifestのstart_url/scope/icons、Service Worker登録先は相対パスを使う。ルートと `/itimonittou2/` のサブパスの両方で利用できる。サーバー側のSPAリライトルールは不要。

## iPhoneのホーム画面に追加

1. **Safari** で、実際の公開URLを開く。
2. 初回はインターネットに接続した状態で教材の表示を待つ。
3. Safariの共有ボタンを押し、**ホーム画面に追加** を選ぶ。
4. 名前を確認して **追加** を押す。
5. ホーム画面の「日本史」アイコンから開く。

iOSの機種・OSバージョンによって共有メニューの位置は異なる。ホーム画面追加、実機Safariの操作、完全終了後の再起動は実機で検証が必要。自動テストのWebKitで確認しても実機確認の代用とはしない。

## オフライン・アプリ更新

- HTTPSまたはlocalhostでService Workerが有効になる。
- 初回に全ファイルのキャッシュが完了してからオフラインで利用できる。
- キャッシュの一部に取得失敗があれば新バージョンのインストールを中止し、前バージョンを維持する。
- アプリ起動時やオンライン復帰時に更新を確認する。
- 更新時は新しいService Workerが待機する。アプリ内の更新ボタンを押すと、状態の保存後に新バージョンを有効化して再読み込みする。学習中の強制再読み込みは行わない。
- 旧キャッシュの削除は新バージョンの有効化時に行う。IndexedDBはキャッシュとは別なので学習履歴や編集内容の削除対象に含まれない。
- Safariのサイトデータ削除・端末側のストレージ削除はアプリの保存データも消す。バックアップ機能でJSONを書き出して保管できる。

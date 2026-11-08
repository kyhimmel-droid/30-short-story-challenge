# 30 Short Story Challenge

30のお題に短篇を1作ずつ選び、一覧画像と共有URLを作る静的サイト。サーバー側の処理はない。

## 構成

- index.html / style.css / app.js … サイト本体（ビルド不要）
- data/aozora.json … 青空文庫の作品一覧から小説（NDC 9x3・K9x3）を抜いたもの。6,637件
- data/isfdb.json … ISFDB の短篇（SHORTFICTION）のうち、収録数5以上か邦題のあるもの。47,084件
- tools/ … 上の2つを作り直すスクリプト

Wikidata はブラウザからその場で検索する（wbsearchentities → wbgetentities で、短篇・文学作品などに絞る）。

## データの作り直し

```sh
# 青空文庫: https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip を展開して
python3 -I tools/build_aozora.py list_person_all_extended_utf8.csv data/aozora.json

# ISFDB: Database Backups の MySQL ダンプ（zip、約315MB）を展開して
python3 -I tools/build_isfdb.py backup-MySQL-55-YYYY-MM-DD data/isfdb.json
```

いまの isfdb.json は 2024-05-18 のバックアップから作った。ISFDB のダウンロードページは現在ログインが必要で、このファイルはウェブアーカイブに残っていた Google Drive のリンクから取った。

## 公開

フォルダをそのまま GitHub Pages などに置けば動く。手元で試すときは `python3 -m http.server` で開く（file:// では data/*.json を読めない）。

## 共有URL

`#d=` のあとに、[題, 作者] の一覧と選者名を JSON → deflate-raw → base64url で詰める。サーバーには何も送らない。

## 出典・ライセンス

- 青空文庫 作品一覧
- ISFDB（https://www.isfdb.org/）CC BY 4.0。サイト下部に表示している
- Wikidata CC0
- 一覧画像を Canvas に直接描く設計は topster（MIT、https://github.com/camdendotlol/topster）を参考にした。コードは使っていない

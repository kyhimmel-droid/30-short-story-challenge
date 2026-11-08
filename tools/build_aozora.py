"""青空文庫の作品一覧 CSV から小説（NDC の各国語の小説 9x3、児童書 K9x3 を含む）を抜き出す。

使い方: python3 -I tools/build_aozora.py list_person_all_extended_utf8.csv data/aozora.json
CSV は https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
短編と長編の区別は一覧に無いので、どちらも残す。
出力の各行: [作品名, 読み, 副題, 作者, 訳者, 底本名, 作品ID, 人物ID]
"""
import csv
import json
import re
import sys

FICTION = re.compile(r"\bK?9\d3\b")
KATA = re.compile(r"^[\u30A0-\u30FF・＝=]+$")


def person(x):
    sei, mei = x["姓"].strip(), x["名"].strip()
    if mei and KATA.match(sei + mei):
        return mei + "・" + sei
    return sei + mei


def main(src, out):
    works = {}
    translators = {}
    with open(src, encoding="utf-8-sig") as f:
        for x in csv.DictReader(f):
            wid = x["作品ID"]
            name = person(x)
            role = x["役割フラグ"]
            if role == "翻訳者":
                translators.setdefault(wid, []).append(name)
                continue
            if role != "著者" or not FICTION.search(x["分類番号"]):
                continue
            if wid in works:
                works[wid][3] += "・" + name
                continue
            works[wid] = [
                x["作品名"], x["作品名読み"], x["副題"], name, "",
                x["底本名1"], int(wid), x["人物ID"],
            ]
    for wid, w in works.items():
        if wid in translators:
            w[4] = "・".join(dict.fromkeys(translators[wid]))
    seen, rows = set(), []
    for w in sorted(works.values(), key=lambda w: (w[1], w[6])):
        key = (w[0], w[2], w[3], w[4])
        if key in seen:
            continue
        seen.add(key)
        rows.append(w)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(len(rows), "works")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

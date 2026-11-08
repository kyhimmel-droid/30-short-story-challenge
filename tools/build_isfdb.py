"""ISFDB の MySQL バックアップから短編（SHORTFICTION）の候補リストを作る。

使い方: python3 -I tools/build_isfdb.py <backup-MySQL-55-YYYY-MM-DD> data/isfdb.json

- 正規の作品（title_parent == 0）だけを採る
- 再録回数（本体と異題・翻訳の収録数の合計）が MIN_PUBS 以上か、日本語版がある作品に絞る
- 日本語版（language = Japanese の異題）があれば邦題として添える
データは ISFDB（https://www.isfdb.org/）、CC BY 4.0。
"""
import html
import json
import re
import sys
from collections import defaultdict

MIN_PUBS = 5
LANG_EN, LANG_JA = 17, 37
WANT = ("titles", "authors", "canonical_author", "pub_content")


def rows(line):
    """INSERT INTO `t` VALUES (...),(...); の1行からタプルを順に返す。"""
    i = line.index("VALUES ") + 7
    n = len(line)
    while i < n:
        if line[i] != "(":
            i += 1
            continue
        i += 1
        vals, cur, inq = [], [], False
        while True:
            c = line[i]
            if inq:
                if c == "\\":
                    nx = line[i + 1]
                    cur.append({"n": "\n", "r": "", "t": "\t", "0": ""}.get(nx, nx))
                    i += 2
                    continue
                if c == "'":
                    inq = False
                else:
                    cur.append(c)
                i += 1
                continue
            if c == "'":
                inq = True
                i += 1
                continue
            if c == "," or c == ")":
                s = "".join(cur)
                vals.append(None if s == "NULL" else s)
                cur = []
                i += 1
                if c == ")":
                    break
                continue
            cur.append(c)
            i += 1
        yield vals


def clean(s):
    return html.unescape(s).strip() if s else ""


def main(src, out):
    titles = {}  # id -> (title, year, storylen, parent, lang)
    authors = {}
    ca = defaultdict(list)
    pubcount = defaultdict(int)
    with open(src, encoding="latin-1") as f:
        for line in f:
            if not line.startswith("INSERT INTO `"):
                continue
            t = line[13:line.index("`", 13)]
            if t not in WANT:
                continue
            for v in rows(line):
                if t == "titles":
                    if v[9] != "SHORTFICTION":
                        continue
                    titles[int(v[0])] = (
                        clean(v[1]),
                        (v[7] or "")[:4],
                        v[8] or "",
                        int(v[12]),
                        int(v[16]) if v[16] else None,
                    )
                elif t == "authors":
                    authors[int(v[0])] = clean(v[1])
                elif t == "canonical_author":
                    if v[3] == "1" and v[1]:
                        ca[int(v[1])].append(int(v[2]))
                elif t == "pub_content":
                    if v[1]:
                        pubcount[int(v[1])] += 1

    canon = {k: x for k, x in titles.items() if x[3] == 0}
    total = defaultdict(int)
    ja = {}
    for k, x in titles.items():
        root = k if x[3] == 0 else x[3]
        if root not in canon:
            continue
        total[root] += pubcount.get(k, 0)
        if x[3] != 0 and x[4] == LANG_JA and root not in ja:
            ja[root] = x[0]

    out_rows = []
    for k, x in canon.items():
        if total[k] < MIN_PUBS and k not in ja:
            continue
        if x[4] not in (None, LANG_EN) and k not in ja:
            continue
        names = [authors.get(a, "") for a in ca.get(k, [])]
        names = [n for n in names if n and n != "uncredited"]
        if not names:
            continue
        out_rows.append([
            x[0],                     # 原題
            ja.get(k, ""),            # 邦題（ISFDB にあれば）
            " & ".join(names),        # 作者
            x[1] if x[1] != "0000" else "",  # 年
            {"novella": "N", "novelette": "T", "short story": "S"}.get(x[2], ""),
            k,                        # ISFDB title id
            total[k],                 # 収録数
        ])
    out_rows.sort(key=lambda r: -r[6])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(out_rows, f, ensure_ascii=False, separators=(",", ":"))
    print(len(titles), "short fiction titles;", len(canon), "canonical;", len(out_rows), "kept;", len(ja), "with Japanese")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

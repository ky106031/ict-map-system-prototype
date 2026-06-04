from pathlib import Path
import re
import pandas as pd


# ===== パス設定 =====
DB_PATH = Path("/Volumes/SSD/MasterThesis/ICTMap_Prototype/ICTマップ_DB.xlsx")
OUTPUT_DIR = Path("/Volumes/SSD/MasterThesis/ICTMap_Prototype/csv")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ===== 基本設定 =====
LAYER_ORDER = {
    "ICT": 1,
    "FUNCTION": 2,
    "OPPORTUNITY": 3,
    "EFFECT": 4,
    "UNIT": 5,
}


def is_empty(value) -> bool:
    return pd.isna(value) or str(value).strip() == ""


def clean(value) -> str:
    if is_empty(value):
        return ""

    if isinstance(value, float) and value.is_integer():
        return str(int(value))

    return str(value).strip()


def make_node_id(layer: str, level: int, label: str) -> str:
    safe = re.sub(r"\s+", "_", label)
    safe = re.sub(r"[^\wぁ-んァ-ヶ一-龥ー_（）()・：:]", "", safe)
    return f"{layer}_L{level}_{safe}"


def add_node(nodes: dict, label: str, layer: str, level: int, parent_id: str | None = None):
    label = clean(label)
    if not label:
        return None

    node_id = make_node_id(layer, level, label)

    if node_id not in nodes:
        nodes[node_id] = {
            "node_id": node_id,
            "label": label,
            "layer": layer,
            "level": level,
            "parent_id": parent_id if parent_id else "",
            "display_order": len(nodes) + 1,
        }

    return node_id


def add_edge(edges: list, source: str, target: str, edge_type: str, paper_id: str = ""):
    if not source or not target or source == target:
        return

    edge_id = f"E{len(edges) + 1:06d}"
    edges.append({
        "edge_id": edge_id,
        "source": source,
        "target": target,
        "edge_type": edge_type,
        "paper_id": paper_id,
    })


def parse_start_indices(value) -> list[int]:
    if is_empty(value):
        return []

    text = str(value).replace("，", ",")
    indices = []

    for part in text.split(","):
        part = part.strip()
        if part.isdigit():
            indices.append(int(part))

    return indices


def get_unit_label(row) -> str:
    content = clean(row.get("内容", ""))
    detail = clean(row.get("内容の細目", ""))

    if content and detail:
        return f"{content}（{detail}）"
    return content


# ===== データ読み込み =====
df = pd.read_excel(DB_PATH)

nodes = {}
edges = []
papers = []


# ===== メイン処理 =====
for _, row in df.iterrows():
    paper_id = clean(row.get("文献番号", row.get("ID", "")))

    # papers.csv
    papers.append({
        "paper_id": paper_id,
        "title": clean(row.get("文献タイトル", "")),
        "authors": clean(row.get("著者", "")),
        "journal": clean(row.get("学会名", "")),
        "year": clean(row.get("公開年", "")),
        "jstage_url": clean(row.get("URL", "")),
        })

    # ===== ICT機器 =====
    ict_nodes = {}

    for i in range(1, 20):
        v1 = clean(row.get(f"ICT_{i}_1", ""))
        v2 = clean(row.get(f"ICT_{i}_2", ""))
        v3 = clean(row.get(f"ICT_{i}_3", ""))

        if not v1 and not v2 and not v3:
            continue

        n1 = add_node(nodes, v1, "ICT", 1)
        n2 = add_node(nodes, v2, "ICT", 2, n1)
        n3 = add_node(nodes, v3, "ICT", 3, n2)

        add_edge(edges, n1, n2, "hierarchy")
        add_edge(edges, n2, n3, "hierarchy")

        ict_nodes[i] = n3

    # ICT内の組み合わせエッジ
    for i, target_node in ict_nodes.items():
        start_indices = parse_start_indices(row.get(f"組み合わせ_{i}", ""))

        for start_i in start_indices:
            source_node = ict_nodes.get(start_i)
            add_edge(edges, source_node, target_node, "relation", paper_id)

    # ===== ICTの機能 =====
    function_nodes = {}

    for i in range(1, 30):
        v1 = clean(row.get(f"ICTの機能_{i}_1", ""))
        v2 = clean(row.get(f"ICTの機能_{i}_2", ""))
        v3 = clean(row.get(f"ICTの機能_{i}_3", ""))

        if not v1 and not v2 and not v3:
            continue

        n1 = add_node(nodes, v1, "FUNCTION", 1)
        n2 = add_node(nodes, v2, "FUNCTION", 2, n1)
        n3 = add_node(nodes, v3, "FUNCTION", 3, n2)

        add_edge(edges, n1, n2, "hierarchy")
        add_edge(edges, n2, n3, "hierarchy")

        function_nodes[i] = n3

        start_indices = parse_start_indices(row.get(f"ICTの機能_{i}_始点", ""))
        for start_i in start_indices:
            source_node = ict_nodes.get(start_i)
            add_edge(edges, source_node, n3, "relation", paper_id)

    # ===== 教育機会 =====
    # 教育機会_*_1 は使用しない
    opportunity_nodes = {}

    for i in range(1, 30):
        v2 = clean(row.get(f"教育機会_{i}_2", ""))
        v3 = clean(row.get(f"教育機会_{i}_3", ""))

        if not v2 and not v3:
            continue

        n2 = add_node(nodes, v2, "OPPORTUNITY", 2)
        n3 = add_node(nodes, v3, "OPPORTUNITY", 3, n2)

        add_edge(edges, n2, n3, "hierarchy")

        opportunity_nodes[i] = n3

        start_indices = parse_start_indices(row.get(f"教育機会_{i}_始点", ""))
        for start_i in start_indices:
            source_node = function_nodes.get(start_i)
            add_edge(edges, source_node, n3, "relation", paper_id)

    # ===== 教育効果 =====
    # 教育効果_*_1 は使用しない
    effect_nodes = {}

    for i in range(1, 40):
        v2 = clean(row.get(f"教育効果_{i}_2", ""))
        v3 = clean(row.get(f"教育効果_{i}_3", ""))

        if not v2 and not v3:
            continue

        n2 = add_node(nodes, v2, "EFFECT", 2)
        n3 = add_node(nodes, v3, "EFFECT", 3, n2)

        add_edge(edges, n2, n3, "hierarchy")

        effect_nodes[i] = n3

        start_indices = parse_start_indices(row.get(f"教育効果_{i}_始点", ""))
        for start_i in start_indices:
            source_node = opportunity_nodes.get(start_i)
            add_edge(edges, source_node, n3, "relation", paper_id)

    # ===== 学年・単元 =====
    school = clean(row.get("学校", ""))
    grade = clean(row.get("学年", ""))
    field = clean(row.get("分野", row.get("領域", "")))
    unit = get_unit_label(row)

    n1 = add_node(nodes, school, "UNIT", 1)

    if school and grade:
        grade_label = f"{school}{grade}年"
    else:
        grade_label = grade

    n2 = add_node(nodes, grade_label, "UNIT", 2, n1)
    n3 = add_node(nodes, field, "UNIT", 3, n2)
    n4 = add_node(nodes, unit, "UNIT", 4, n3)

    add_edge(edges, n1, n2, "hierarchy")
    add_edge(edges, n2, n3, "hierarchy")
    add_edge(edges, n3, n4, "hierarchy")

    # 教育効果 → 学年・単元
    for effect_node in effect_nodes.values():
        add_edge(edges, effect_node, n4, "relation", paper_id)


# ===== DataFrame化 =====
nodes_df = pd.DataFrame(nodes.values())
edges_df = pd.DataFrame(edges)
papers_df = pd.DataFrame(papers).drop_duplicates(subset=["paper_id"])


# ===== 重複エッジ除去 =====
edges_df = edges_df.drop_duplicates(
    subset=["source", "target", "edge_type", "paper_id"]
).reset_index(drop=True)

edges_df["edge_id"] = [f"E{i + 1:06d}" for i in range(len(edges_df))]


# ===== CSV出力 =====
nodes_df.to_csv(OUTPUT_DIR / "nodes.csv", index=False, encoding="utf-8-sig")
edges_df.to_csv(OUTPUT_DIR / "edges.csv", index=False, encoding="utf-8-sig")
papers_df.to_csv(OUTPUT_DIR / "papers.csv", index=False, encoding="utf-8-sig")


print("CSV変換完了")
print(f"nodes.csv: {len(nodes_df)} 件")
print(f"edges.csv: {len(edges_df)} 件")
print(f"papers.csv: {len(papers_df)} 件")
print(f"出力先: {OUTPUT_DIR}")
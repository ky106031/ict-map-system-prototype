import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import cytoscape from "cytoscape";

const LAYERS = [
  { id: "LAYER_ICT", label: "ICT機器", layer: "ICT", x: 100, y: 200, firstLevel: "1", maxLevel: 3 },
  { id: "LAYER_FUNCTION", label: "ICTの機能", layer: "FUNCTION", x: 410, y: 200, firstLevel: "1", maxLevel: 3 },
  { id: "LAYER_OPPORTUNITY", label: "教育機会", layer: "OPPORTUNITY", x: 720, y: 200, firstLevel: "2", maxLevel: 3 },
  { id: "LAYER_EFFECT", label: "教育効果", layer: "EFFECT", x: 1030, y: 200, firstLevel: "2", maxLevel: 3 },
  { id: "LAYER_UNIT", label: "学年・単元", layer: "UNIT", x: 1340, y: 200, firstLevel: "1", maxLevel: 4 },
];

const LAYER_EDGES = [
  ["LAYER_ICT", "LAYER_FUNCTION"],
  ["LAYER_FUNCTION", "LAYER_OPPORTUNITY"],
  ["LAYER_OPPORTUNITY", "LAYER_EFFECT"],
  ["LAYER_EFFECT", "LAYER_UNIT"],
];

const LAYER_COLORS = {
  ICT: { panel: "#E9DCC9", card: "#F8F3EA" },
  FUNCTION: { panel: "#F7D6E0", card: "#FFF7FA" },
  OPPORTUNITY: { panel: "#F7E79C", card: "#FFFDF5" },
  EFFECT: { panel: "#D9F0A3", card: "#F9FFF0" },
  UNIT: { panel: "#FFFFFF", card: "#FAFAFA" },
};

const LAYER_X = {
  ICT: 120,
  FUNCTION: 820,
  OPPORTUNITY: 1520,
  EFFECT: 2220,
  UNIT: 2920,
};

const ALL_GRAPH_X = {
  ICT: 120,
  FUNCTION: 3120,
  OPPORTUNITY: 6120,
  EFFECT: 9120,
  UNIT: 12120,
};

function App() {
  const cyRef = useRef(null);
  const containerRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [papers, setPapers] = useState([]);

  const [viewMode, setViewMode] = useState("initial");
  const [selectedSearchNodeIds, setSelectedSearchNodeIds] = useState([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState([]);

  const [searchPanelOpen, setSearchPanelOpen] = useState(true);
  const [activeSearchSection, setActiveSearchSection] = useState("ICT");

  const [searchSelections, setSearchSelections] = useState({
    ICT: {},
    FUNCTION: {},
    OPPORTUNITY: {},
    EFFECT: {},
    UNIT: {},
  });

  const [overlay, setOverlay] = useState({
    isOpen: false,
    layerConfig: null,
    parentNodeId: null,
    breadcrumb: [],
  });

  useEffect(() => {
    Papa.parse("/data/nodes.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => setNodes(result.data),
    });

    Papa.parse("/data/edges.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => setEdges(result.data),
    });

    Papa.parse("/data/papers.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => setPapers(result.data),
    });
  }, []);

  const normalizePaperId = (id) => {
    const text = String(id).trim();
    if (text.endsWith(".0")) return text.slice(0, -2);
    return text;
  };

  const splitPaperIds = (paperId) => {
    if (!paperId) return [];
    return String(paperId)
      .split(",")
      .map((id) => normalizePaperId(id))
      .filter(Boolean);
  };

  const getDescendantNodeIds = (nodeId) => {
    const result = new Set([nodeId]);

    const visit = (currentId) => {
      nodes
        .filter((n) => n.parent_id === currentId)
        .forEach((child) => {
          if (!result.has(child.node_id)) {
            result.add(child.node_id);
            visit(child.node_id);
          }
        });
    };

    visit(nodeId);
    return [...result];
  };

  const getCurrentOptions = () => {
    if (!overlay.isOpen) return [];

    if (overlay.parentNodeId) {
      return nodes
        .filter((n) => n.parent_id === overlay.parentNodeId)
        .sort((a, b) => Number(a.display_order) - Number(b.display_order));
    }

    return nodes
      .filter(
        (n) =>
          n.layer === overlay.layerConfig.layer &&
          String(n.level) === String(overlay.layerConfig.firstLevel)
      )
      .sort((a, b) => Number(a.display_order) - Number(b.display_order));
  };

  const getRelatedSubgraph = (startNodeId) => {
    const relationEdges = edges.filter((e) => e.edge_type === "relation");
    const startNode = nodes.find((n) => n.node_id === startNodeId);
    const selectedLayer = startNode?.layer;

    const nodeSet = new Set([startNodeId]);
    const edgeMap = new Map();

    const traceBackward = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      relationEdges
        .filter((e) => e.target === nodeId)
        .forEach((edge) => {
          if (!nodes.find((n) => n.node_id === edge.source)) return;
          nodeSet.add(edge.source);
          edgeMap.set(edge.edge_id, edge);
          traceBackward(edge.source, visited);
        });
    };

    const traceForward = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      relationEdges
        .filter((e) => e.source === nodeId)
        .forEach((edge) => {
          if (!nodes.find((n) => n.node_id === edge.target)) return;
          nodeSet.add(edge.target);
          edgeMap.set(edge.edge_id, edge);
          traceForward(edge.target, visited);
        });
    };

    traceBackward(startNodeId);
    traceForward(startNodeId);

    const filteredNodeIds = Array.from(nodeSet).filter((nodeId) => {
      const node = nodes.find((n) => n.node_id === nodeId);
      if (!node) return false;
      return !(node.layer === selectedLayer && node.node_id !== startNodeId);
    });

    const filteredNodeIdSet = new Set(filteredNodeIds);

    const filteredEdges = Array.from(edgeMap.values()).filter(
      (edge) => filteredNodeIdSet.has(edge.source) && filteredNodeIdSet.has(edge.target)
    );

    return { nodeIds: filteredNodeIds, relationEdges: filteredEdges };
  };

  const getMultiConditionSubgraph = (conditionNodeIds) => {
    if (conditionNodeIds.length === 0) {
      return { nodeIds: [], relationEdges: [] };
    }

    if (conditionNodeIds.length === 1) {
      return getRelatedSubgraph(conditionNodeIds[0]);
    }

    const relationEdges = edges.filter((e) => e.edge_type === "relation");

    const conditionTargetSets = conditionNodeIds.map(
      (conditionNodeId) => new Set(getDescendantNodeIds(conditionNodeId))
    );

    const allPaperIds = new Set();

    relationEdges.forEach((edge) => {
      splitPaperIds(edge.paper_id).forEach((paperId) => allPaperIds.add(paperId));
    });

    const matchedPaperIds = [...allPaperIds].filter((paperId) => {
      const paperEdges = relationEdges.filter((edge) =>
        splitPaperIds(edge.paper_id).includes(paperId)
      );

      return conditionTargetSets.every((targetSet) =>
        paperEdges.some(
          (edge) => targetSet.has(edge.source) || targetSet.has(edge.target)
        )
      );
    });

    const matchedPaperSet = new Set(matchedPaperIds);

    const matchedEdges = relationEdges.filter((edge) =>
      splitPaperIds(edge.paper_id).some((paperId) => matchedPaperSet.has(paperId))
    );

    const nodeIdSet = new Set(conditionNodeIds);

    matchedEdges.forEach((edge) => {
      nodeIdSet.add(edge.source);
      nodeIdSet.add(edge.target);
    });

    return {
      nodeIds: [...nodeIdSet],
      relationEdges: matchedEdges,
    };
  };

  const buildLayerElements = () => [
    ...LAYERS.map((n) => ({
      group: "nodes",
      data: { id: n.id, label: n.label, layer: n.layer, isLayerNode: "true" },
      position: { x: n.x, y: n.y },
    })),
    ...LAYER_EDGES.map(([source, target], index) => ({
      group: "edges",
      data: { id: `LAYER_EDGE_${index}`, source, target },
    })),
  ];

  const buildSubgraphElements = () => {
    const { nodeIds, relationEdges } = getMultiConditionSubgraph(selectedSearchNodeIds);
    const targetNodes = nodes.filter((n) => nodeIds.includes(n.node_id));

    const grouped = {};
    targetNodes.forEach((node) => {
      if (!grouped[node.layer]) grouped[node.layer] = [];
      grouped[node.layer].push(node);
    });

    Object.keys(grouped).forEach((layer) => {
      grouped[layer].sort((a, b) => Number(a.display_order) - Number(b.display_order));
    });

    const elements = [];

    Object.entries(grouped).forEach(([layer, layerNodes]) => {
      const x = LAYER_X[layer] ?? 100;
      const spacingY = 180;
      const startY = 220 - ((layerNodes.length - 1) * spacingY) / 2;

      layerNodes.forEach((node, index) => {
        elements.push({
          group: "nodes",
          data: {
            id: node.node_id,
            label: node.label,
            layer: node.layer,
            level: node.level,
            isSubgraphNode: "true",
          },
          position: { x, y: startY + index * spacingY },
          classes: selectedSearchNodeIds.includes(node.node_id)
            ? "selected-subgraph-node"
            : "",
        });
      });
    });

    relationEdges.forEach((edge) => {
      elements.push({
        group: "edges",
        data: {
          id: edge.edge_id,
          source: edge.source,
          target: edge.target,
          paper_id: edge.paper_id,
          edge_type: edge.edge_type,
        },
        classes: "relation-edge",
      });
    });

    return elements;
  };

  const buildAllGraphElements = () => {
    const relationEdges = edges.filter((e) => e.edge_type === "relation");
    const elements = [];

    const grouped = {};
    nodes.forEach((node) => {
      if (!grouped[node.layer]) grouped[node.layer] = [];
      grouped[node.layer].push(node);
    });

    Object.keys(grouped).forEach((layer) => {
      grouped[layer].sort((a, b) => Number(a.display_order) - Number(b.display_order));
    });

    Object.entries(grouped).forEach(([layer, layerNodes]) => {
      const x = ALL_GRAPH_X[layer] ?? 100;
      const spacingY = 80;
      const startY = 220 - ((layerNodes.length - 1) * spacingY) / 2;

      layerNodes.forEach((node, index) => {
        elements.push({
          group: "nodes",
          data: {
            id: node.node_id,
            label: node.label,
            layer: node.layer,
            level: node.level,
            isAllGraphNode: "true",
          },
          position: {
            x,
            y: startY + index * spacingY,
          },
          classes: "all-graph-node",
        });
      });
    });

    relationEdges.forEach((edge) => {
      elements.push({
        group: "edges",
        data: {
          id: edge.edge_id,
          source: edge.source,
          target: edge.target,
          paper_id: edge.paper_id,
          edge_type: edge.edge_type,
        },
        classes: "all-graph-edge",
      });
    });

    return elements;
  };

  const buildElements = () => {
    if (viewMode === "all") return buildAllGraphElements();
    if (selectedSearchNodeIds.length > 0) return buildSubgraphElements();
    return buildLayerElements();
  };

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    if (cyRef.current) cyRef.current.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      layout: { name: "preset" },
      autoungrabify: viewMode !== "all",
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            shape: "round-rectangle",
            width: "230px",
            height: "100px",
            padding: "16px",
            "font-size": "24px",
            "font-weight": "bold",
            color: "#333",
            "border-width": 1.5,
            "border-color": "#999",
            "text-wrap": "wrap",
            "text-max-width": "200px",
            "text-overflow-wrap": "anywhere",
          },
        },
        { selector: 'node[layer = "ICT"]', style: { "background-color": "#E9DCC9" } },
        { selector: 'node[layer = "FUNCTION"]', style: { "background-color": "#F7D6E0" } },
        { selector: 'node[layer = "OPPORTUNITY"]', style: { "background-color": "#F7E79C" } },
        { selector: 'node[layer = "EFFECT"]', style: { "background-color": "#D9F0A3" } },
        { selector: 'node[layer = "UNIT"]', style: { "background-color": "#FFFFFF" } },
        {
          selector: ".selected-subgraph-node",
          style: { "border-width": 4, "border-color": "#222" },
        },
        {
          selector: ".all-graph-node",
          style: {
            label: "data(label)",
            width: "90px",
            height: "24px",
            "font-size": "5px",
            "font-weight": "bold",
            "text-wrap": "wrap",
            "text-max-width": "80px",
            "text-overflow-wrap": "anywhere",
            "border-width": 0.6,
            "border-color": "#777",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#333",
            "target-arrow-color": "#333",
            "target-arrow-shape": "triangle",
            "curve-style": "straight",
          },
        },
        {
          selector: ".relation-edge",
          style: {
            width: 2.2,
            "line-color": "#222",
            "target-arrow-color": "#222",
            "target-arrow-shape": "triangle",
            "curve-style": "straight",
          },
        },
        {
          selector: ".all-graph-edge",
          style: {
            width: 0.6,
            "line-color": "rgba(30,30,30,0.35)",
            "target-arrow-color": "rgba(30,30,30,0.35)",
            "target-arrow-shape": "none",
            "curve-style": "straight",
          },
        },
      ],
      minZoom: 0.02,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    cyRef.current = cy;

    cy.on("tap", "edge", (event) => {
      const paperId = event.target.data("paper_id");
      if (!paperId) return;

      setSelectedPaperIds(
        String(paperId)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      );
    });

    cy.on("tap", "node", (event) => {
      const tapped = event.target;

      if (viewMode === "all") return;

      if (selectedSearchNodeIds.length === 0 && tapped.data("isLayerNode") === "true") {
        const layerConfig = LAYERS.find((l) => l.id === tapped.id());
        setOverlay({
          isOpen: true,
          layerConfig,
          parentNodeId: null,
          breadcrumb: [{ id: layerConfig.id, label: layerConfig.label }],
        });
      }
    });

    setTimeout(() => {
      cy.fit(cy.elements(), viewMode === "all" ? 10 : 20);
      cy.center();
    }, 0);

    return () => cy.destroy();
  }, [nodes, edges, selectedSearchNodeIds, viewMode]);

  const handleOptionClick = (option) => {
    const children = nodes.filter((n) => n.parent_id === option.node_id);

    if (children.length === 0) {
      setSelectedSearchNodeIds([option.node_id]);
      setViewMode("search");
      closeOverlay();
      return;
    }

    setOverlay((prev) => ({
      ...prev,
      parentNodeId: option.node_id,
      breadcrumb: [...prev.breadcrumb, { id: option.node_id, label: option.label }],
    }));
  };

  const closeOverlay = () => {
    setOverlay({ isOpen: false, layerConfig: null, parentNodeId: null, breadcrumb: [] });
  };

  const resetMap = () => {
    setViewMode("initial");
    setSelectedSearchNodeIds([]);
    setSelectedPaperIds([]);
    closeOverlay();
  };

  const showAllGraph = () => {
    setViewMode("all");
    setSelectedSearchNodeIds([]);
    setSelectedPaperIds([]);
    closeOverlay();
    setSearchPanelOpen(false);
  };

  const goBack = () => {
    if (overlay.breadcrumb.length <= 1) {
      closeOverlay();
      return;
    }

    const newBreadcrumb = overlay.breadcrumb.slice(0, -1);
    const last = newBreadcrumb[newBreadcrumb.length - 1];
    const isLayer = LAYERS.some((l) => l.id === last.id);

    setOverlay((prev) => ({
      ...prev,
      parentNodeId: isLayer ? null : last.id,
      breadcrumb: newBreadcrumb,
    }));
  };

  const updateSearchSelection = (layer, level, value) => {
    setSearchSelections((prev) => {
      const next = { ...prev[layer], [level]: value };

      Object.keys(next).forEach((key) => {
        if (Number(key) > Number(level)) {
          next[key] = "";
        }
      });

      return {
        ...prev,
        [layer]: next,
      };
    });
  };

  const getSearchOptions = (layerConfig, level) => {
    const selections = searchSelections[layerConfig.layer] ?? {};

    if (String(level) === String(layerConfig.firstLevel)) {
      return nodes
        .filter(
          (n) =>
            n.layer === layerConfig.layer &&
            String(n.level) === String(layerConfig.firstLevel)
        )
        .sort((a, b) => Number(a.display_order) - Number(b.display_order));
    }

    const previousNodeId = selections[level - 1];
    if (!previousNodeId) return [];

    return nodes
      .filter((n) => n.parent_id === previousNodeId)
      .sort((a, b) => Number(a.display_order) - Number(b.display_order));
  };

  const getDeepestSelectedNodeId = (layer) => {
    const selections = searchSelections[layer] ?? {};
    const selectedLevels = Object.keys(selections)
      .filter((key) => selections[key])
      .map(Number)
      .sort((a, b) => b - a);

    if (selectedLevels.length === 0) return "";
    return selections[selectedLevels[0]];
  };

  const getAllSelectedConditionNodeIds = () => {
    return LAYERS.map((layerConfig) => getDeepestSelectedNodeId(layerConfig.layer)).filter(Boolean);
  };

  const runMultiConditionSearch = () => {
    const targetNodeIds = getAllSelectedConditionNodeIds();
    if (targetNodeIds.length === 0) return;

    setViewMode("search");
    setSelectedSearchNodeIds(targetNodeIds);
    setSelectedPaperIds([]);
    closeOverlay();
    setSearchPanelOpen(false);
  };

  const resetSearch = () => {
    setSearchSelections({
      ICT: {},
      FUNCTION: {},
      OPPORTUNITY: {},
      EFFECT: {},
      UNIT: {},
    });
    resetMap();
    setSearchPanelOpen(true);
  };

  const options = getCurrentOptions();

  const selectedPapers = papers.filter((paper) =>
    selectedPaperIds.includes(String(paper.paper_id))
  );

  const selectedConditionNodeIds = getAllSelectedConditionNodeIds();

  return (
    <div style={{ height: "100vh", width: "100vw", background: "#f7f7f7" }}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: "24px", margin: 0 }}>ICTマップ Prototype</h1>
        <span style={{ color: "#666" }}>
          Nodes: {nodes.length} / Edges: {edges.length} / Papers: {papers.length}
        </span>

        <button onClick={showAllGraph} style={buttonStyle}>
          全体表示
        </button>

        {(selectedSearchNodeIds.length > 0 || viewMode === "all") && (
          <button onClick={resetMap} style={buttonStyle}>
            初期表示に戻る
          </button>
        )}
      </header>

      <main style={{ height: "calc(100vh - 60px)", position: "relative", display: "flex" }}>
        <button
          onClick={() => setSearchPanelOpen((prev) => !prev)}
          title={searchPanelOpen ? "検索パネルを閉じる" : "検索パネルを開く"}
          style={{
            position: "absolute",
            left: searchPanelOpen ? "300px" : "12px",
            top: "14px",
            zIndex: 8,
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            fontSize: "22px",
            lineHeight: "1",
          }}
        >
          {searchPanelOpen ? "‹" : "☰"}
        </button>

        {searchPanelOpen && (
          <aside style={searchPanelStyle}>
            <h2 style={{ marginTop: 0, fontSize: "20px" }}>検索条件</h2>

            {LAYERS.map((layerConfig) => {
              const isOpen = activeSearchSection === layerConfig.layer;
              const selectedNodeIdForLayer = getDeepestSelectedNodeId(layerConfig.layer);
              const selectedNode = nodes.find((n) => n.node_id === selectedNodeIdForLayer);

              return (
                <div key={layerConfig.layer} style={{ marginBottom: "12px" }}>
                  <button
                    onClick={() =>
                      setActiveSearchSection(isOpen ? "" : layerConfig.layer)
                    }
                    style={{
                      ...sectionButtonStyle,
                      background: LAYER_COLORS[layerConfig.layer]?.panel ?? "#fff",
                    }}
                  >
                    {layerConfig.label}
                    <span style={{ float: "right" }}>{isOpen ? "−" : "+"}</span>
                  </button>

                  {selectedNode && (
                    <div style={selectedConditionStyle}>
                      選択中：{selectedNode.label}
                    </div>
                  )}

                  {isOpen && (
                    <div style={sectionBodyStyle}>
                      {Array.from(
                        {
                          length:
                            Number(layerConfig.maxLevel) -
                            Number(layerConfig.firstLevel) +
                            1,
                        },
                        (_, i) => Number(layerConfig.firstLevel) + i
                      ).map((level) => {
                        const optionList = getSearchOptions(layerConfig, level);
                        const selections = searchSelections[layerConfig.layer] ?? {};
                        const disabled =
                          level !== Number(layerConfig.firstLevel) &&
                          !selections[level - 1];

                        return (
                          <div key={`${layerConfig.layer}_${level}`}>
                            <label style={labelStyle}>第{level}層</label>
                            <select
                              value={selections[level] ?? ""}
                              onChange={(e) =>
                                updateSearchSelection(
                                  layerConfig.layer,
                                  level,
                                  e.target.value
                                )
                              }
                              disabled={disabled}
                              style={selectStyle}
                            >
                              <option value="">選択してください</option>
                              {optionList.map((node) => (
                                <option key={node.node_id} value={node.node_id}>
                                  {node.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={runMultiConditionSearch}
              disabled={selectedConditionNodeIds.length === 0}
              style={{
                ...primaryButtonStyle,
                opacity: selectedConditionNodeIds.length > 0 ? 1 : 0.45,
              }}
            >
              検索する
            </button>

            <button onClick={resetSearch} style={{ ...buttonStyle, width: "100%" }}>
              リセット
            </button>
          </aside>
        )}

        <div
          ref={containerRef}
          style={{
            flex: 1,
            height: "100%",
            background: "#ffffff",
            filter: overlay.isOpen ? "blur(3px)" : "none",
            opacity: overlay.isOpen ? 0.28 : 1,
            transition: "filter 300ms ease, opacity 300ms ease",
          }}
        />

        {overlay.isOpen && (
          <div style={overlayStyle}>
            <div
              style={{
                width: "min(1100px, 86vw)",
                maxHeight: "82vh",
                background:
                  LAYER_COLORS[overlay.layerConfig?.layer]?.panel ??
                  "rgba(255,255,255,0.92)",
                border: "1px solid #ddd",
                borderRadius: "28px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
                padding: "28px",
                boxSizing: "border-box",
                animation: "panelIn 320ms ease-out",
                overflow: "hidden",
              }}
            >
              <div style={overlayHeaderStyle}>
                <div>
                  <div style={{ fontSize: "15px", color: "#666", marginBottom: "6px" }}>
                    {overlay.breadcrumb.map((b) => b.label).join(" ＞ ")}
                  </div>
                  <h2 style={{ margin: 0, fontSize: "30px" }}>
                    {overlay.breadcrumb[overlay.breadcrumb.length - 1]?.label}
                  </h2>
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={goBack} style={buttonStyle}>戻る</button>
                  <button onClick={closeOverlay} style={buttonStyle}>閉じる</button>
                </div>
              </div>

              <div style={cardGridStyle}>
                {options.map((option, index) => (
                  <button
                    key={option.node_id}
                    onClick={() => handleOptionClick(option)}
                    style={{
                      ...cardStyle,
                      background:
                        LAYER_COLORS[overlay.layerConfig?.layer]?.card ?? "#ffffff",
                      animation: `cardIn 260ms ease-out ${index * 25}ms both`,
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedPaperIds.length > 0 && (
          <div onClick={() => setSelectedPaperIds([])} style={paperModalOverlayStyle}>
            <div onClick={(e) => e.stopPropagation()} style={paperModalStyle}>
              <div style={modalHeaderStyle}>
                <h2 style={{ margin: 0 }}>関連文献</h2>
                <button onClick={() => setSelectedPaperIds([])} style={buttonStyle}>
                  閉じる
                </button>
              </div>

              {selectedPapers.map((paper) => (
                <div key={paper.paper_id} style={{ borderTop: "1px solid #ddd", padding: "16px 0" }}>
                  <h3 style={{ margin: "0 0 8px" }}>{paper.title}</h3>
                  <p style={{ margin: "4px 0" }}>著者：{paper.authors}</p>
                  <p style={{ margin: "4px 0" }}>学会誌：{paper.journal}</p>
                  <p style={{ margin: "4px 0" }}>公開年：{paper.year}</p>
                  {paper.jstage_url && (
                    <a href={paper.jstage_url} target="_blank" rel="noreferrer">
                      J-STAGEで開く
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <style>
        {`
          @keyframes overlayIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          @keyframes panelIn {
            from {
              opacity: 0;
              transform: scale(0.84) translateY(24px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          @keyframes cardIn {
            from {
              opacity: 0;
              transform: scale(0.92) translateY(18px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
}

const headerStyle = {
  height: "60px",
  display: "flex",
  alignItems: "center",
  padding: "0 24px",
  background: "#ffffff",
  borderBottom: "1px solid #ddd",
  boxSizing: "border-box",
  gap: "22px",
  position: "relative",
  zIndex: 5,
};

const searchPanelStyle = {
  width: "320px",
  flexShrink: 0,
  padding: "20px",
  boxSizing: "border-box",
  borderRight: "1px solid #ddd",
  background: "#fafafa",
  zIndex: 4,
  overflowY: "auto",
};

const sectionButtonStyle = {
  width: "100%",
  padding: "12px 14px",
  marginBottom: "8px",
  borderRadius: "12px",
  border: "1px solid #ccc",
  fontWeight: "bold",
  fontSize: "15px",
  cursor: "pointer",
  textAlign: "left",
};

const selectedConditionStyle = {
  fontSize: "13px",
  color: "#555",
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: "10px",
  padding: "8px 10px",
  marginBottom: "8px",
};

const sectionBodyStyle = {
  padding: "12px",
  marginBottom: "12px",
  borderRadius: "14px",
  border: "1px solid #e0e0e0",
  background: "#fff",
};

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  fontWeight: "bold",
};

const selectStyle = {
  width: "100%",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid #ccc",
  marginBottom: "16px",
  fontSize: "15px",
};

const buttonStyle = {
  border: "1px solid #ccc",
  background: "#fff",
  borderRadius: "999px",
  padding: "8px 16px",
  fontSize: "14px",
  cursor: "pointer",
};

const primaryButtonStyle = {
  ...buttonStyle,
  width: "100%",
  marginBottom: "10px",
  background: "#222",
  color: "#fff",
};

const cardStyle = {
  minHeight: "74px",
  border: "1px solid #d0d0d0",
  borderRadius: "18px",
  padding: "14px 18px",
  fontSize: "17px",
  fontWeight: 600,
  color: "#333",
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(0,0,0,0.08)",
  textAlign: "center",
  transition: "transform 180ms ease, box-shadow 180ms ease",
};

const overlayStyle = {
  position: "absolute",
  inset: 0,
  background: "rgba(255,255,255,0.72)",
  backdropFilter: "blur(10px)",
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  animation: "overlayIn 260ms ease-out",
};

const overlayHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "22px",
  gap: "16px",
};

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "18px",
  overflowY: "auto",
  maxHeight: "62vh",
  padding: "6px",
};

const paperModalOverlayStyle = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.25)",
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const paperModalStyle = {
  width: "min(720px, 88vw)",
  maxHeight: "76vh",
  overflowY: "auto",
  background: "#fff",
  borderRadius: "24px",
  padding: "28px",
  boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "18px",
};

export default App;
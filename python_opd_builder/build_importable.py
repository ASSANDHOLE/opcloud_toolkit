#!/usr/bin/env python3
"""Build an OPCloud-importable export JSON from the authoring format."""

from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


JsonDict = Dict[str, Any]
NAMESPACE = uuid.UUID("2f5b6fc8-28a1-4f6d-9f68-4e10c6d5622d")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def canonicalize_ref(ref: Optional[str]) -> Optional[str]:
    if ref is None:
        return None
    text = str(ref).strip()
    return text or None


def split_ref(ref: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    text = canonicalize_ref(ref)
    if not text:
        return None, None
    if "/" in text:
        node_key, state_key = text.split("/", 1)
        return node_key, state_key
    return text, None


def make_uuid(label: str) -> str:
    return str(uuid.uuid5(NAMESPACE, label))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def local_type(kind: Optional[str]) -> Optional[str]:
    if kind == "object":
        return "opm.Object"
    if kind == "process":
        return "opm.Process"
    return kind


def clean_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: clean_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [clean_none(item) for item in value]
    return value


def build_importable(data: JsonDict) -> JsonDict:
    diagrams = list(data.get("diagrams") or [])
    diagrams_by_key = {diagram.get("key"): diagram for diagram in diagrams if diagram.get("key")}
    diagram_id_by_key = {
        diagram.get("key"): ("SD" if diagram.get("parent") in (None, "") and diagram.get("name") == "SD"
                             else make_uuid(f"diagram:{diagram.get('key')}"))
        for diagram in diagrams
    }

    entries: List[JsonDict] = []
    for diagram in diagrams:
        diagram_key = diagram.get("key")
        diagram_id = diagram_id_by_key[diagram_key]
        parent_key = diagram.get("parent")
        parent_id = diagram_id_by_key.get(parent_key, diagram_id if diagram.get("name") == "SD" else "SD")

        node_id_by_key: Dict[str, str] = {}
        state_id_by_ref: Dict[str, str] = {}
        nodes = list(diagram.get("nodes") or [])

        for node in nodes:
            node_key = node.get("key")
            node_id_by_key[node_key] = make_uuid(f"diagram:{diagram_key}:node:{node_key}")
            for state in node.get("states") or []:
                state_key = state.get("key")
                state_ref = f"{node_key}/{state_key}"
                state_id_by_ref[state_ref] = make_uuid(f"diagram:{diagram_key}:state:{state_ref}")

        def resolve_ref_id(ref: Optional[str]) -> Optional[str]:
            node_key, state_key = split_ref(ref)
            if not node_key:
                return None
            if state_key:
                return state_id_by_ref.get(f"{node_key}/{state_key}")
            return node_id_by_key.get(node_key)

        child_node_ids_by_parent: Dict[str, List[str]] = {}
        state_ids_by_parent: Dict[str, List[str]] = {}
        importable_nodes: List[JsonDict] = []
        states_by_parent: Dict[str, List[JsonDict]] = {}

        for node in nodes:
            node_key = node.get("key")
            node_id = node_id_by_key[node_key]
            parent_node_id = node_id_by_key.get(node.get("parent"))
            state_entries = []
            state_ids = []

            for state in node.get("states") or []:
                state_key = state.get("key")
                state_ref = f"{node_key}/{state_key}"
                state_id = state_id_by_ref[state_ref]
                state_ids.append(state_id)
                state_entries.append(
                    clean_none(
                        {
                            "id": state_id,
                            "label": state.get("name"),
                            "position": state.get("position"),
                            "size": state.get("size"),
                            "parentId": node_id,
                        }
                    )
                )

            if state_entries:
                states_by_parent[node_id] = state_entries
                state_ids_by_parent[node_id] = state_ids

            if parent_node_id:
                child_node_ids_by_parent.setdefault(parent_node_id, []).append(node_id)

        for node in nodes:
            node_key = node.get("key")
            node_id = node_id_by_key[node_key]
            parent_node_id = node_id_by_key.get(node.get("parent"))
            child_node_ids = child_node_ids_by_parent.get(node_id, [])
            state_ids = state_ids_by_parent.get(node_id, [])
            embedded_ids = [*state_ids, *child_node_ids]
            attributes = node.get("attributes") or {}

            importable_nodes.append(
                clean_none(
                    {
                        "id": node_id,
                        "type": local_type(node.get("kind")),
                        "label": node.get("name"),
                        "position": node.get("position"),
                        "size": node.get("size"),
                        "essence": attributes.get("essence"),
                        "affiliation": attributes.get("affiliation"),
                        "statesArrange": attributes.get("statesArrange"),
                        "parentId": parent_node_id,
                        "embeddedIds": embedded_ids,
                        "embeddedThingIds": child_node_ids,
                        "isInZoomContainer": bool(child_node_ids),
                    }
                )
            )

        procedural_links = []
        for link in diagram.get("links") or []:
            if (link.get("kind") or "procedural") != "procedural":
                continue
            link_key = link.get("key")
            procedural_links.append(
                clean_none(
                    {
                        "id": make_uuid(f"diagram:{diagram_key}:link:{link_key}"),
                        "linkType": link.get("type"),
                        "sourceId": resolve_ref_id(link.get("from")),
                        "targetId": resolve_ref_id(link.get("to")),
                        "geometry": link.get("geometry") or {"vertices": [], "labels": []},
                    }
                )
            )

        fundamental_groups = []
        for group in diagram.get("groups") or []:
            if (group.get("kind") or "fundamental") != "fundamental":
                continue
            group_key = group.get("key")
            triangle_id = make_uuid(f"diagram:{diagram_key}:group:{group_key}:triangle")
            owner_id = resolve_ref_id(group.get("owner"))
            member_links = []
            member_ids = []

            for member in group.get("members") or []:
                member_key = member.get("key")
                target_id = resolve_ref_id(member.get("to"))
                member_ids.append(target_id)
                member_links.append(
                    clean_none(
                        {
                            "id": make_uuid(f"diagram:{diagram_key}:group:{group_key}:member:{member_key}"),
                            "linkType": member.get("type", group.get("type")),
                            "targetId": target_id,
                            "geometry": member.get("geometry") or {"vertices": [], "labels": []},
                        }
                    )
                )

            fundamental_groups.append(
                clean_none(
                    {
                        "triangleId": triangle_id,
                        "triangleGeometry": group.get("triangle"),
                        "ownerId": owner_id,
                        "groupType": group.get("type"),
                        "ownerLink": {
                            "id": make_uuid(f"diagram:{diagram_key}:group:{group_key}:owner-link"),
                            "geometry": group.get("ownerLinkGeometry") or {"vertices": [], "labels": []},
                        },
                        "memberIds": member_ids,
                        "memberLinks": member_links,
                    }
                )
            )

        child_diagrams = [item for item in diagrams if item.get("parent") == diagram_key]
        focal_node_key = diagram.get("focalNode")
        focal_name = None
        if focal_node_key and parent_key in diagrams_by_key:
            for node in diagrams_by_key[parent_key].get("nodes") or []:
                if node.get("key") == focal_node_key:
                    focal_name = node.get("name")
                    break

        path_keys = []
        current = diagram
        seen = set()
        while current and current.get("key") not in seen:
            seen.add(current.get("key"))
            path_keys.append(current.get("name") or current.get("key"))
            current = diagrams_by_key.get(current.get("parent"))
        path_keys.reverse()

        entries.append(
            clean_none(
                {
                    "hierarchy": {
                        "opdId": diagram_id,
                        "opdName": diagram.get("name"),
                        "opdPath": path_keys,
                        "parentOpdId": parent_id,
                        "parentOpdName": (diagrams_by_key.get(parent_key) or {}).get("name"),
                        "childOpdIds": [diagram_id_by_key[item.get("key")] for item in child_diagrams],
                        "focalThingLabelInParent": focal_name,
                    },
                    "local": {
                        "version": 2,
                        "meta": {
                            "exportedAt": now_iso(),
                            "tool": "opcloud-authoring-builder",
                        },
                        "nodes": importable_nodes,
                        "statesByParent": states_by_parent,
                        "proceduralLinks": procedural_links,
                        "fundamentalGroups": fundamental_groups,
                        "leftovers": [],
                    },
                    "currentContents": None,
                    "scaffold": None,
                }
            )
        )

    return clean_none(
        {
            "version": 1,
            "meta": {
                "exportedAt": now_iso(),
                "tool": "opcloud-authoring-builder",
                "opdCount": len(entries),
            },
            "opds": entries,
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Path to authoring JSON")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output path for the importable JSON (default: <input>.importable.json)",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output or input_path.with_name(f"{input_path.stem}.importable.json")

    data = load_json(input_path)
    rebuilt = build_importable(data)
    dump_json(output_path, rebuilt)


if __name__ == "__main__":
    main()

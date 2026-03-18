#!/usr/bin/env python3
"""Convert OPCloud exports into an authoring-first JSON format.

The authoring format is meant for humans or AI to write diagrams from scratch.
It uses stable semantic `key` values instead of OPCloud export IDs.

It can also re-canonicalize an existing authoring file so keys stay stable
across continuous edits.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


JsonDict = Dict[str, Any]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def slugify(value: Optional[str], fallback: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or fallback


def unique_key(base: str, used: set[str]) -> str:
    candidate = base
    index = 2
    while candidate in used:
        candidate = f"{base}-{index}"
        index += 1
    used.add(candidate)
    return candidate


def clean_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: clean_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [clean_none(item) for item in value]
    return value


def local_type(kind: Optional[str]) -> Optional[str]:
    if kind == "object":
        return "opm.Object"
    if kind == "process":
        return "opm.Process"
    return kind


def author_type(opm_type: Optional[str]) -> Optional[str]:
    if opm_type == "opm.Object":
        return "object"
    if opm_type == "opm.Process":
        return "process"
    return opm_type


def canonicalize_ref(ref: Optional[str]) -> Optional[str]:
    if ref is None:
        return None
    text = str(ref).strip()
    return text or None


def format_state_ref(node_key: str, state_key: str) -> str:
    return f"{node_key}/{state_key}"


def split_ref(ref: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    text = canonicalize_ref(ref)
    if not text:
        return None, None
    if "/" in text:
        node_key, state_key = text.split("/", 1)
        return node_key, state_key
    return text, None


def build_authoring_from_importable(data: JsonDict) -> JsonDict:
    diagrams: List[JsonDict] = []
    used_diagram_keys: set[str] = set()

    for entry in data.get("opds") or []:
        hierarchy = entry.get("hierarchy") or {}
        local = entry.get("local") or {}
        diagram_name = hierarchy.get("opdName") or hierarchy.get("opdId") or "diagram"
        path_bits = hierarchy.get("opdPath") or [diagram_name]
        diagram_key = unique_key(slugify(".".join(str(bit) for bit in path_bits), "diagram"), used_diagram_keys)

        nodes = list(local.get("nodes") or [])
        states_by_parent = dict(local.get("statesByParent") or {})
        procedural_links = list(local.get("proceduralLinks") or [])
        fundamental_groups = list(local.get("fundamentalGroups") or [])

        node_key_by_id: Dict[str, str] = {}
        state_ref_by_id: Dict[str, str] = {}
        node_used_keys: set[str] = set()

        for node in nodes:
            base = slugify(node.get("label"), author_type(node.get("type")) or "node")
            node_key_by_id[node.get("id")] = unique_key(base, node_used_keys)

        authored_nodes: List[JsonDict] = []
        for node in nodes:
            node_id = node.get("id")
            node_key = node_key_by_id[node_id]
            state_used_keys: set[str] = set()
            authored_states: List[JsonDict] = []
            for state in states_by_parent.get(node_id) or []:
                state_key = unique_key(slugify(state.get("label"), "state"), state_used_keys)
                state_ref_by_id[state.get("id")] = format_state_ref(node_key, state_key)
                authored_states.append(
                    clean_none(
                        {
                            "key": state_key,
                            "name": state.get("label"),
                            "position": state.get("position"),
                            "size": state.get("size"),
                        }
                    )
                )

            authored_nodes.append(
                clean_none(
                    {
                        "key": node_key,
                        "name": node.get("label"),
                        "kind": author_type(node.get("type")),
                        "parent": node_key_by_id.get(node.get("parentId")),
                        "position": node.get("position"),
                        "size": node.get("size"),
                        "attributes": {
                            "essence": node.get("essence"),
                            "affiliation": node.get("affiliation"),
                        },
                        "states": authored_states,
                    }
                )
            )

        link_used_keys: set[str] = set()
        authored_links: List[JsonDict] = []
        for link in procedural_links:
            source_ref = state_ref_by_id.get(link.get("sourceId")) or node_key_by_id.get(link.get("sourceId"))
            target_ref = state_ref_by_id.get(link.get("targetId")) or node_key_by_id.get(link.get("targetId"))
            base = slugify(
                f"{source_ref or 'src'}-{link.get('linkType', 'link')}-{target_ref or 'tgt'}",
                "link",
            )
            authored_links.append(
                clean_none(
                    {
                        "key": unique_key(base, link_used_keys),
                        "kind": "procedural",
                        "type": link.get("linkType"),
                        "from": source_ref,
                        "to": target_ref,
                        "geometry": link.get("geometry"),
                    }
                )
            )

        group_used_keys: set[str] = set()
        authored_groups: List[JsonDict] = []
        for group in fundamental_groups:
            owner_ref = state_ref_by_id.get(group.get("ownerId")) or node_key_by_id.get(group.get("ownerId"))
            base = slugify(f"group-{owner_ref or 'owner'}-{group.get('groupType', 'fundamental')}", "group")
            members = []
            member_keys = set()
            for member in group.get("memberLinks") or []:
                target_ref = state_ref_by_id.get(member.get("targetId")) or node_key_by_id.get(member.get("targetId"))
                member_key = unique_key(slugify(target_ref, "member"), member_keys)
                members.append(
                    clean_none(
                        {
                            "key": member_key,
                            "to": target_ref,
                            "type": member.get("linkType"),
                            "geometry": member.get("geometry"),
                        }
                    )
                )

            authored_groups.append(
                clean_none(
                    {
                        "key": unique_key(base, group_used_keys),
                        "kind": "fundamental",
                        "type": group.get("groupType"),
                        "owner": owner_ref,
                        "triangle": group.get("triangleGeometry"),
                        "ownerLinkGeometry": (group.get("ownerLink") or {}).get("geometry"),
                        "members": members,
                    }
                )
            )

        diagrams.append(
            clean_none(
                {
                    "key": diagram_key,
                    "name": diagram_name,
                    "parent": None if hierarchy.get("opdId") == "SD" else None,
                    "focalNode": None,
                    "nodes": authored_nodes,
                    "links": authored_links,
                    "groups": authored_groups,
                }
            )
        )

    diagram_by_opd_id = {
        (entry.get("hierarchy") or {}).get("opdId"): diagram
        for entry, diagram in zip(data.get("opds") or [], diagrams)
    }

    for entry, diagram in zip(data.get("opds") or [], diagrams):
        hierarchy = entry.get("hierarchy") or {}
        parent_opd_id = hierarchy.get("parentOpdId")
        focal_label = hierarchy.get("focalThingLabelInParent")
        if parent_opd_id and parent_opd_id != hierarchy.get("opdId") and parent_opd_id in diagram_by_opd_id:
            parent_diagram = diagram_by_opd_id[parent_opd_id]
            diagram["parent"] = parent_diagram["key"]
            for node in parent_diagram.get("nodes") or []:
                if node.get("name") == focal_label:
                    diagram["focalNode"] = node.get("key")
                    break

    return clean_none(
        {
            "format": "opcloud-authoring",
            "version": 1,
            "meta": {
                "sourceVersion": data.get("version"),
                "sourceMeta": data.get("meta"),
            },
            "diagrams": diagrams,
        }
    )


def canonicalize_authoring(data: JsonDict) -> JsonDict:
    raw_diagrams = list(data.get("diagrams") or [])
    used_diagram_keys: set[str] = set()
    diagram_key_map: Dict[str, str] = {}

    for index, diagram in enumerate(raw_diagrams):
        diagram_name = diagram.get("name") or diagram.get("key") or f"diagram-{index + 1}"
        source_key = diagram.get("key") or diagram_name
        diagram_key_map[source_key] = unique_key(slugify(source_key, "diagram"), used_diagram_keys)

    def rewrite_ref(ref: Optional[str], node_map: Dict[str, str], state_map: Dict[str, str]) -> Optional[str]:
        node_key, state_key = split_ref(ref)
        if not node_key:
            return None
        mapped_node = node_map.get(node_key, node_key)
        if not state_key:
            return mapped_node
        mapped_state = state_map.get(f"{node_key}/{state_key}", state_key)
        return f"{mapped_node}/{mapped_state}"

    diagrams: List[JsonDict] = []
    for index, diagram in enumerate(raw_diagrams):
        diagram_name = diagram.get("name") or diagram.get("key") or f"diagram-{index + 1}"
        source_diagram_key = diagram.get("key") or diagram_name
        diagram_key = diagram_key_map[source_diagram_key]

        node_used_keys: set[str] = set()
        node_key_map: Dict[str, str] = {}
        state_key_map: Dict[str, str] = {}

        for node in diagram.get("nodes") or []:
            source_node_key = node.get("key") or node.get("name")
            node_key_map[source_node_key] = unique_key(
                slugify(source_node_key, author_type(node.get("kind")) or "node"),
                node_used_keys,
            )

        nodes: List[JsonDict] = []
        for node in diagram.get("nodes") or []:
            source_node_key = node.get("key") or node.get("name")
            node_key = node_key_map[source_node_key]
            state_used_keys: set[str] = set()
            states = []
            for state in node.get("states") or []:
                source_state_key = state.get("key") or state.get("name")
                state_key = unique_key(slugify(source_state_key, "state"), state_used_keys)
                state_key_map[f"{source_node_key}/{source_state_key}"] = state_key
                states.append(
                    clean_none(
                        {
                            "key": state_key,
                            "name": state.get("name"),
                            "position": state.get("position"),
                            "size": state.get("size"),
                        }
                    )
                )

            nodes.append(
                clean_none(
                    {
                        "key": node_key,
                        "name": node.get("name"),
                        "kind": author_type(local_type(node.get("kind"))),
                        "parent": node_key_map.get(node.get("parent"), canonicalize_ref(node.get("parent"))),
                        "position": node.get("position"),
                        "size": node.get("size"),
                        "attributes": {
                            "essence": ((node.get("attributes") or {}).get("essence")),
                            "affiliation": ((node.get("attributes") or {}).get("affiliation")),
                        },
                        "states": states,
                    }
                )
            )

        link_used_keys: set[str] = set()
        links = []
        for link in diagram.get("links") or []:
            link_key = unique_key(slugify(link.get("key"), "link"), link_used_keys)
            links.append(
                clean_none(
                    {
                        "key": link_key,
                        "kind": link.get("kind") or "procedural",
                        "type": link.get("type"),
                        "from": rewrite_ref(link.get("from"), node_key_map, state_key_map),
                        "to": rewrite_ref(link.get("to"), node_key_map, state_key_map),
                        "geometry": link.get("geometry"),
                    }
                )
            )

        group_used_keys: set[str] = set()
        groups = []
        for group in diagram.get("groups") or []:
            group_key = unique_key(slugify(group.get("key"), "group"), group_used_keys)
            member_used_keys: set[str] = set()
            members = []
            for member in group.get("members") or []:
                member_key = unique_key(slugify(member.get("key") or member.get("to"), "member"), member_used_keys)
                members.append(
                    clean_none(
                        {
                            "key": member_key,
                            "to": rewrite_ref(member.get("to"), node_key_map, state_key_map),
                            "type": member.get("type"),
                            "geometry": member.get("geometry"),
                        }
                    )
                )

            groups.append(
                clean_none(
                    {
                        "key": group_key,
                        "kind": group.get("kind") or "fundamental",
                        "type": group.get("type"),
                        "owner": rewrite_ref(group.get("owner"), node_key_map, state_key_map),
                        "triangle": group.get("triangle"),
                        "ownerLinkGeometry": group.get("ownerLinkGeometry"),
                        "members": members,
                    }
                )
            )

        diagrams.append(
            clean_none(
                {
                    "key": diagram_key,
                    "name": diagram_name,
                    "parent": diagram_key_map.get(diagram.get("parent"), canonicalize_ref(diagram.get("parent"))),
                    "focalNode": node_key_map.get(diagram.get("focalNode"), canonicalize_ref(diagram.get("focalNode"))),
                    "nodes": nodes,
                    "links": links,
                    "groups": groups,
                }
            )
        )

    return clean_none(
        {
            "format": "opcloud-authoring",
            "version": 1,
            "meta": data.get("meta") or {},
            "diagrams": diagrams,
        }
    )


def convert(data: JsonDict) -> JsonDict:
    if data.get("format") == "opcloud-authoring":
        return canonicalize_authoring(data)
    return build_authoring_from_importable(data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Path to importable or authoring JSON")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output path for the authoring JSON (default: <input>.authoring.json)",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output or input_path.with_name(f"{input_path.stem}.authoring.json")

    data = load_json(input_path)
    authored = convert(data)
    dump_json(output_path, authored)


if __name__ == "__main__":
    main()

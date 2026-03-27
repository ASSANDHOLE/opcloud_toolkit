#!/usr/bin/env python3
"""Python builder API for the OPCloud authoring format."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum, IntEnum
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union, Tuple

JsonDict = Dict[str, Any]


class Essence(IntEnum):
    """OPM essence axis.

    `PHYSICAL` is `0`, `INFORMATICAL` is `1`.
    """

    PHYSICAL = 0
    INFORMATICAL = 1


class Affiliation(IntEnum):
    """OPM affiliation axis.

    `SYSTEMIC` is `0`, `ENVIRONMENTAL` is `1`.
    """

    SYSTEMIC = 0
    ENVIRONMENTAL = 1


class OpmStyle(Enum):
    """Named OPM style combinations for node essence/affiliation."""

    SYSTEMIC_PHYSICAL = (Essence.PHYSICAL, Affiliation.SYSTEMIC)
    SYSTEMIC_INFORMATICAL = (Essence.INFORMATICAL, Affiliation.SYSTEMIC)
    ENVIRONMENTAL_PHYSICAL = (Essence.PHYSICAL, Affiliation.ENVIRONMENTAL)
    ENVIRONMENTAL_INFORMATICAL = (Essence.INFORMATICAL, Affiliation.ENVIRONMENTAL)

    @property
    def essence(self) -> int:
        return int(self.value[0])

    @property
    def affiliation(self) -> int:
        return int(self.value[1])


class LinkType(IntEnum):
    AGENT = 0
    INSTRUMENT = 1
    CONSUMPTION = 2
    RESULT = 3
    EFFECT = 4
    INVOCATION = 5
    AGGREGATION = 11
    EXHIBITION = 12
    GENERALIZATION = 13
    CLASSIFICATION = 14


FUNDAMENTAL_LINK_TYPES = {
    LinkType.AGGREGATION,
    LinkType.EXHIBITION,
    LinkType.GENERALIZATION,
    LinkType.CLASSIFICATION,
}


def _slugify(value: Optional[str], fallback: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or fallback


def _clean_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _clean_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_clean_none(item) for item in value]
    return value


def _resolve_style(
    *,
    style: Optional[OpmStyle],
    essence: Optional[Union[int, Essence]],
    affiliation: Optional[Union[int, Affiliation]],
) -> tuple[Optional[int], Optional[int]]:
    if style is not None:
        return style.essence, style.affiliation
    return (
        None if essence is None else int(essence),
        None if affiliation is None else int(affiliation),
    )


@dataclass
class StateSpec:
    key: str
    name: str
    position: Optional[JsonDict] = None
    size: Optional[JsonDict] = None

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "key": self.key,
                "name": self.name,
                "position": self.position,
                "size": self.size,
            }
        )

    def ref(self, owner: "NodeSpec") -> str:
        return f"{owner.key}/{self.key}"


@dataclass
class NodeSpec:
    key: str
    name: str
    kind: str
    position: Optional[JsonDict] = None
    size: Optional[JsonDict] = None
    parent: Optional[str] = None
    essence: Optional[int] = None
    affiliation: Optional[int] = None
    states_arrange: Optional[str] = None
    states: List[StateSpec] = field(default_factory=list)

    def _ensure_default_states_arrange(self) -> None:
        if self.kind == "object" and self.states and self.states_arrange is None:
            self.states_arrange = "bottom"

    def ref(self, state: Optional[Union[str, StateSpec]] = None) -> str:
        if state is None:
            return self.key
        state_key = state.key if isinstance(state, StateSpec) else state
        return f"{self.key}/{state_key}"

    def add_state(
        self,
        name: str,
        key: Optional[str] = None,
        *,
        position: Optional[JsonDict] = None,
        size: Optional[JsonDict] = None,
    ) -> StateSpec:
        state_key = key or self._unique_state_key(_slugify(name, "state"))
        state = StateSpec(key=state_key, name=name, position=position, size=size)
        self.states.append(state)
        self._ensure_default_states_arrange()
        return state

    def update_states(self, *names: str) -> "NodeSpec":
        self.states = []
        for name in names:
            self.add_state(name)
        self._ensure_default_states_arrange()
        return self

    def updateState(self, *names: str) -> "NodeSpec":
        return self.update_states(*names)

    def _unique_state_key(self, base: str) -> str:
        used = {state.key for state in self.states}
        candidate = base
        index = 2
        while candidate in used:
            candidate = f"{base}-{index}"
            index += 1
        return candidate

    def clone_for_child_diagram(self, *, parent: Optional[str] = None) -> "NodeSpec":
        return NodeSpec(
            key=self.key,
            name=self.name,
            kind=self.kind,
            position=self.position.copy() if isinstance(self.position, dict) else self.position,
            size=self.size.copy() if isinstance(self.size, dict) else self.size,
            parent=parent,
            essence=self.essence,
            affiliation=self.affiliation,
            states_arrange=self.states_arrange,
            states=[StateSpec(**state.to_dict()) for state in self.states],
        )

    def to_dict(self) -> JsonDict:
        self._ensure_default_states_arrange()
        return _clean_none(
            {
                "key": self.key,
                "name": self.name,
                "kind": self.kind,
                "parent": self.parent,
                "position": self.position,
                "size": self.size,
                "attributes": {
                    "essence": self.essence,
                    "affiliation": self.affiliation,
                    "statesArrange": self.states_arrange,
                },
                "states": [state.to_dict() for state in self.states],
            }
        )


class OpmObject(NodeSpec):
    def __init__(
        self,
        name: str,
        key: Optional[str] = None,
        *,
        position: Optional[JsonDict] = None,
        size: Optional[JsonDict] = None,
        parent: Optional[str] = None,
        style: Optional[OpmStyle] = None,
        essence: Optional[Union[int, Essence]] = None,
        affiliation: Optional[Union[int, Affiliation]] = None,
        states_arrange: Optional[str] = None,
    ) -> None:
        """Create an OPM object node.

        Use `style=` when you want a named OPM combination like
        `OpmStyle.SYSTEMIC_PHYSICAL`.
        Use raw `essence=` / `affiliation=` only when you explicitly need the
        numeric axes from OPCloud.
        """
        resolved_essence, resolved_affiliation = _resolve_style(
            style=style,
            essence=essence,
            affiliation=affiliation,
        )
        super().__init__(
            key=key or _slugify(name, "object"),
            name=name,
            kind="object",
            position=position,
            size=size,
            parent=parent,
            essence=resolved_essence,
            affiliation=resolved_affiliation,
            states_arrange=states_arrange,
        )


class OpmProcess(NodeSpec):
    def __init__(
        self,
        name: str,
        key: Optional[str] = None,
        *,
        position: Optional[JsonDict] = None,
        size: Optional[JsonDict] = None,
        parent: Optional[str] = None,
        style: Optional[OpmStyle] = None,
        essence: Optional[Union[int, Essence]] = None,
        affiliation: Optional[Union[int, Affiliation]] = None,
        states_arrange: Optional[str] = None,
    ) -> None:
        """Create an OPM process node.

        Use `style=` when you want a named OPM combination like
        `OpmStyle.SYSTEMIC_INFORMATICAL`.
        Use raw `essence=` / `affiliation=` only when you explicitly need the
        numeric axes from OPCloud.
        """
        resolved_essence, resolved_affiliation = _resolve_style(
            style=style,
            essence=essence,
            affiliation=affiliation,
        )
        super().__init__(
            key=key or _slugify(name, "process"),
            name=name,
            kind="process",
            position=position,
            size=size,
            parent=parent,
            essence=resolved_essence,
            affiliation=resolved_affiliation,
            states_arrange=states_arrange,
        )


@dataclass
class ProceduralLinkSpec:
    key: str
    type: int
    source: str
    target: str
    geometry: Optional[JsonDict] = None

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "key": self.key,
                "kind": "procedural",
                "type": self.type,
                "from": self.source,
                "to": self.target,
                "geometry": self.geometry,
            }
        )


@dataclass
class FundamentalMemberSpec:
    key: str
    target: str
    type: int
    geometry: Optional[JsonDict] = None

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "key": self.key,
                "to": self.target,
                "type": self.type,
                "geometry": self.geometry,
            }
        )


@dataclass
class FundamentalGroupSpec:
    key: str
    type: int
    owner: str
    members: List[FundamentalMemberSpec] = field(default_factory=list)
    triangle: Optional[JsonDict] = None
    owner_link_geometry: Optional[JsonDict] = None

    def add_member(
        self,
        target: str,
        *,
        key: Optional[str] = None,
        type: Optional[int] = None,
        geometry: Optional[JsonDict] = None,
    ) -> FundamentalMemberSpec:
        member_key = key or self._unique_member_key(_slugify(target.replace("/", "-"), "member"))
        member = FundamentalMemberSpec(
            key=member_key,
            target=target,
            type=self.type if type is None else type,
            geometry=geometry,
        )
        self.members.append(member)
        return member

    def _unique_member_key(self, base: str) -> str:
        used = {member.key for member in self.members}
        candidate = base
        index = 2
        while candidate in used:
            candidate = f"{base}-{index}"
            index += 1
        return candidate

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "key": self.key,
                "kind": "fundamental",
                "type": self.type,
                "owner": self.owner,
                "triangle": self.triangle,
                "ownerLinkGeometry": self.owner_link_geometry,
                "members": [member.to_dict() for member in self.members],
            }
        )


NodeInput = Union[NodeSpec, str]


class OpdDiagram:
    def __init__(
        self,
        project: "AuthoringProject",
        *,
        key: str,
        name: str,
        parent: Optional[str] = None,
        focal_node: Optional[str] = None,
    ) -> None:
        self.project = project
        self.key = key
        self.name = name
        self.parent = parent
        self.focal_node = focal_node
        self.nodes: List[NodeSpec] = []
        self.links: List[ProceduralLinkSpec] = []
        self.groups: List[FundamentalGroupSpec] = []
        self._auto_layout_counters: Dict[str, int] = {}

    def _unique_key(self, existing: Iterable[str], base: str) -> str:
        used = set(existing)
        candidate = base
        index = 2
        while candidate in used:
            candidate = f"{base}-{index}"
            index += 1
        return candidate

    def _node_key(self, node_or_key: NodeInput) -> str:
        if isinstance(node_or_key, NodeSpec):
            return node_or_key.key
        return node_or_key

    def _normalize_link_type(self, link_type: Union[int, LinkType]) -> int:
        return int(link_type)

    def _default_size(self, kind: str, has_states: bool = False) -> JsonDict:
        if kind == "process":
            return {"width": 135, "height": 60}
        if has_states:
            return {"width": 150, "height": 80}
        return {"width": 135, "height": 60}

    def _next_auto_position(self, parent: Optional[str] = None) -> JsonDict:
        bucket = parent or "__root__"
        index = self._auto_layout_counters.get(bucket, 0)
        self._auto_layout_counters[bucket] = index + 1

        col = index % 4
        row = index // 4
        base_x = 120 if parent is None else 90
        base_y = 120 if parent is None else 240
        return {
            "x": base_x + col * 180,
            "y": base_y + row * 140,
        }

    def find_node(self, key: str) -> Optional[NodeSpec]:
        for node in self.nodes:
            if node.key == key:
                return node
        return None

    def find_node_by_name(self, name: str) -> Optional[NodeSpec]:
        for node in self.nodes:
            if node.name == name:
                return node
        return None

    def _split_ref(self, ref: str) -> tuple[str, Optional[str]]:
        if "/" in ref:
            node_key, state_key = ref.split("/", 1)
            return node_key, state_key
        return ref, None

    def _ref_key(self, endpoint: NodeInput) -> str:
        return self._node_key(endpoint)

    def _state_refs_for_node(self, node: NodeSpec) -> List[str]:
        return [node.ref(state) for state in node.states]

    def _descendant_nodes(self, node_key: str) -> List[NodeSpec]:
        out: List[NodeSpec] = []
        pending = [node_key]
        while pending:
            current = pending.pop(0)
            for node in self.nodes:
                if node.parent == current and node not in out:
                    out.append(node)
                    pending.append(node.key)
        return out

    def _clone_node_to_child(self, child: "OpdDiagram", node: NodeSpec) -> NodeSpec:
        existing = child.find_node(node.key)
        if existing:
            return existing
        parent_key = None
        if node.parent and self.find_node(node.parent):
            self._ensure_ref_node_in_child(child, node.parent)
            if child.find_node(node.parent):
                parent_key = node.parent
        cloned = node.clone_for_child_diagram(parent=parent_key)
        child.add_node(cloned)
        return cloned

    def _ensure_ref_node_in_child(self, child: "OpdDiagram", ref: str) -> Optional[NodeSpec]:
        node_key, _ = self._split_ref(ref)
        node = self.find_node(node_key)
        if not node:
            return None
        if node.parent and self.find_node(node.parent):
            self._ensure_ref_node_in_child(child, node.parent)
        return self._clone_node_to_child(child, node)

    def _all_refs_for_nodes(self, nodes: Iterable[NodeSpec]) -> set[str]:
        refs: set[str] = set()
        for node in nodes:
            refs.add(node.key)
            refs.update(self._state_refs_for_node(node))
        return refs

    def _copy_group_subset(
        self,
        child: "OpdDiagram",
        group: FundamentalGroupSpec,
        *,
        owner_ref: str,
        member_refs: List[str],
    ) -> None:
        self._ensure_ref_node_in_child(child, owner_ref)
        for ref in member_refs:
            self._ensure_ref_node_in_child(child, ref)
        copy = child.add_fundamental_group(
            owner_ref,
            type=group.type,
            key=group.key,
            triangle=group.triangle,
            owner_link_geometry=group.owner_link_geometry,
        )
        for member in group.members:
            if member.target in member_refs:
                copy.add_member(member.target, key=member.key, type=member.type, geometry=member.geometry)

    def _copy_link(
        self,
        child: "OpdDiagram",
        link: ProceduralLinkSpec,
        *,
        source_ref: Optional[str] = None,
        target_ref: Optional[str] = None,
    ) -> None:
        src = source_ref or link.source
        tgt = target_ref or link.target
        self._ensure_ref_node_in_child(child, src)
        self._ensure_ref_node_in_child(child, tgt)
        child.add_link(src, tgt, type=link.type, key=link.key, geometry=link.geometry)

    def add_node(self, node: NodeSpec) -> NodeSpec:
        if self.find_node(node.key):
            raise ValueError(f"Node key already exists in diagram {self.key}: {node.key}")
        self.nodes.append(node)
        return node

    def add_object(self, node: Union[OpmObject, str], **kwargs: Any) -> OpmObject:
        if isinstance(node, OpmObject):
            if node.position is None:
                node.position = self._next_auto_position(node.parent)
            if node.size is None:
                node.size = self._default_size("object", bool(node.states))
            node._ensure_default_states_arrange()
            return self.add_node(node)  # type: ignore[return-value]
        if "position" not in kwargs or kwargs["position"] is None:
            kwargs["position"] = self._next_auto_position(kwargs.get("parent"))
        if "size" not in kwargs or kwargs["size"] is None:
            kwargs["size"] = self._default_size("object")
        obj = OpmObject(node, **kwargs)
        self.add_node(obj)
        return obj

    def add_process(self, node: Union[OpmProcess, str], **kwargs: Any) -> OpmProcess:
        if isinstance(node, OpmProcess):
            if node.position is None:
                node.position = self._next_auto_position(node.parent)
            if node.size is None:
                node.size = self._default_size("process")
            return self.add_node(node)  # type: ignore[return-value]
        if "position" not in kwargs or kwargs["position"] is None:
            kwargs["position"] = self._next_auto_position(kwargs.get("parent"))
        if "size" not in kwargs or kwargs["size"] is None:
            kwargs["size"] = self._default_size("process")
        proc = OpmProcess(node, **kwargs)
        self.add_node(proc)
        return proc

    def addObject(self, node: Union[OpmObject, str], location: Optional[JsonDict] = None, size: Optional[JsonDict] = None, **kwargs: Any) -> OpmObject:
        if location is not None:
            kwargs["position"] = location
        if size is not None:
            kwargs["size"] = size
        return self.add_object(node, **kwargs)

    def addProcess(self, node: Union[OpmProcess, str], location: Optional[JsonDict] = None, size: Optional[JsonDict] = None, **kwargs: Any) -> OpmProcess:
        if location is not None:
            kwargs["position"] = location
        if size is not None:
            kwargs["size"] = size
        return self.add_process(node, **kwargs)

    def add_link(
        self,
        source: NodeInput,
        target: Union[NodeInput, Sequence[NodeInput]],
        *,
        type: Union[int, LinkType],
        key: Optional[str] = None,
        geometry: Optional[JsonDict] = None,
        triangle: Optional[JsonDict] = None,
        owner_link_geometry: Optional[JsonDict] = None,
    ) -> Union[ProceduralLinkSpec, FundamentalGroupSpec]:
        link_type = self._normalize_link_type(type)
        if isinstance(target, Sequence) and not isinstance(target, (str, bytes)):
            if LinkType(link_type) not in FUNDAMENTAL_LINK_TYPES:
                raise ValueError("Multiple targets are only supported for fundamental link types")
            return self.add_fundamental_group(
                source,
                type=link_type,
                key=key,
                triangle=triangle,
                owner_link_geometry=owner_link_geometry,
                members=list(target),
            )

        source_ref = self._node_key(source)
        target_ref = self._node_key(target)
        link_key = key or self._unique_key(
            (item.key for item in self.links),
            _slugify(f"{source_ref}-{link_type}-{target_ref}", "link"),
        )
        link = ProceduralLinkSpec(
            key=link_key,
            type=link_type,
            source=source_ref,
            target=target_ref,
            geometry=geometry,
        )
        self.links.append(link)
        return link

    def addLink(
        self,
        link_type: Union[int, LinkType],
        source: NodeInput,
        target: Union[NodeInput, Sequence[NodeInput]],
        **kwargs: Any,
    ) -> Union[ProceduralLinkSpec, FundamentalGroupSpec]:
        return self.add_link(source, target, type=link_type, **kwargs)

    def add_fundamental_group(
        self,
        owner: NodeInput,
        *,
        type: Union[int, LinkType],
        key: Optional[str] = None,
        triangle: Optional[JsonDict] = None,
        owner_link_geometry: Optional[JsonDict] = None,
        members: Optional[Sequence[NodeInput]] = None,
    ) -> FundamentalGroupSpec:
        owner_ref = self._node_key(owner)
        link_type = self._normalize_link_type(type)
        group_key = key or self._unique_key(
            (item.key for item in self.groups),
            _slugify(f"group-{owner_ref}-{link_type}", "group"),
        )
        group = FundamentalGroupSpec(
            key=group_key,
            type=link_type,
            owner=owner_ref,
            triangle=triangle,
            owner_link_geometry=owner_link_geometry,
        )
        for member in members or []:
            group.add_member(self._node_key(member))
        self.groups.append(group)
        return group

    def find_group_by_owner(self, owner) -> List[FundamentalGroupSpec]:
        return [g for g in self.groups if g.owner == self._node_key(owner)]

    def addGroup(self, link_type: Union[int, LinkType], owner: NodeInput, members: Sequence[NodeInput], **kwargs: Any) -> FundamentalGroupSpec:
        return self.add_fundamental_group(owner, type=link_type, members=members, **kwargs)

    def delete_endpoint(self, endpoint: NodeInput) -> None:
        ref = self._ref_key(endpoint)
        node_key, state_key = self._split_ref(ref)

        refs_to_remove: set[str] = set()
        node_keys_to_remove: set[str] = set()

        if state_key:
            node = self.find_node(node_key)
            if not node:
                return
            node.states = [state for state in node.states if state.key != state_key]
            refs_to_remove.add(ref)
        else:
            node = self.find_node(node_key)
            if not node:
                return
            descendants = self._descendant_nodes(node_key)
            all_nodes = [node, *descendants]
            node_keys_to_remove.update(item.key for item in all_nodes)
            refs_to_remove.update(self._all_refs_for_nodes(all_nodes))
            self.nodes = [item for item in self.nodes if item.key not in node_keys_to_remove]

        self.links = [
            link
            for link in self.links
            if link.source not in refs_to_remove and link.target not in refs_to_remove
        ]
        self.groups = [
            group
            for group in self.groups
            if group.owner not in refs_to_remove and all(member.target not in refs_to_remove for member in group.members)
        ]

    def deleteEndpoint(self, endpoint: NodeInput) -> None:
        self.delete_endpoint(endpoint)

    def unfold(self, focal: NodeInput, *, key: Optional[str] = None, name: Optional[str] = None, inherit: bool = True) -> \
            Tuple["OpdDiagram", Optional[List[NodeInput]]]:
        focal_key = self._node_key(focal)
        focal_node = self.find_node(focal_key)
        if not focal_node:
            raise ValueError(f"Focal node not found in diagram {self.key}: {focal_key}")

        child_name = name or focal_node.name
        child_key = key or self.project._unique_diagram_key(_slugify(child_name, "diagram"))
        child = self.project.add_diagram(key=child_key, name=child_name, parent=self.key, focal_node=focal_key)
        focal_clone = focal_node.clone_for_child_diagram(parent=None)
        child.add_node(focal_clone)
        if not inherit:
            return child, None

        descendants = self._descendant_nodes(focal_key)
        for node in descendants:
            self._clone_node_to_child(child, node)

        inherited_refs = self._all_refs_for_nodes([focal_node, *descendants])

        for link in self.links:
            touches_source = link.source in inherited_refs
            touches_target = link.target in inherited_refs
            if not (touches_source or touches_target):
                continue
            other_ref = link.target if touches_source else link.source
            self._ensure_ref_node_in_child(child, other_ref)
            self._copy_link(child, link)

        for group in self.groups:
            owner_in = group.owner in inherited_refs
            member_refs_in = [member.target for member in group.members if member.target in inherited_refs]
            if owner_in:
                member_refs = [member.target for member in group.members]
                self._copy_group_subset(child, group, owner_ref=group.owner, member_refs=member_refs)
            elif member_refs_in:
                self._copy_group_subset(child, group, owner_ref=group.owner, member_refs=member_refs_in)
        return child, descendants

    def inzoom(self, focal: NodeInput, *, key: Optional[str] = None, name: Optional[str] = None, inherit: bool = True,
               first_process_name: str = "{} Consume", last_process_name: str = "{} Yield") -> \
            Tuple[OpdDiagram, OpmProcess, OpmProcess, Optional[List[NodeSpec]]]:
        focal_key = self._node_key(focal)
        focal_node = self.find_node(focal_key)
        if not focal_node:
            raise ValueError(f"Focal node not found in diagram {self.key}: {focal_key}")
        if focal_node.kind != "process":
            raise ValueError("inzoom() currently expects a process focal node")

        child_name = name or focal_node.name
        child_key = key or self.project._unique_diagram_key(_slugify(child_name, "diagram"))
        child = self.project.add_diagram(key=child_key, name=child_name, parent=self.key, focal_node=focal_key)
        focal_clone = focal_node.clone_for_child_diagram(parent=None)
        child.add_node(focal_clone)

        focal_pos = focal_clone.position or {"x": 250, "y": 180}
        def try_format(target_str: str, param: str) -> Optional[str]:
            try:
                ret = target_str.format(param)
                return ret
            except KeyError:
                return None

        consume_proc = child.add_process(
            try_format(first_process_name, focal_node.name) or first_process_name,
            key=f"{focal_key}-consume",
            parent=focal_key,
            position={"x": focal_pos["x"] + 40, "y": focal_pos["y"] + 70},
        )
        yield_proc = child.add_process(
            try_format(last_process_name, focal_node.name) or last_process_name,
            key=f"{focal_key}-yield",
            parent=focal_key,
            position={"x": focal_pos["x"] + 40, "y": focal_pos["y"] + 180},
        )
        if not inherit:
            return child, consume_proc, yield_proc, None

        descendants = self._descendant_nodes(focal_key)
        for node in descendants:
            self._clone_node_to_child(child, node)

        internal_refs = self._all_refs_for_nodes([focal_node, *descendants])

        for group in self.groups:
            if int(group.type) != int(LinkType.EXHIBITION):
                continue
            owner_in = group.owner in internal_refs
            member_refs_in = [member.target for member in group.members if member.target in internal_refs]
            if owner_in:
                member_refs = [member.target for member in group.members]
                self._copy_group_subset(child, group, owner_ref=group.owner, member_refs=member_refs)
            elif member_refs_in:
                self._copy_group_subset(child, group, owner_ref=group.owner, member_refs=member_refs_in)

        focal_refs = {focal_key, *self._state_refs_for_node(focal_node)}
        for link in self.links:
            source_in = link.source in internal_refs
            target_in = link.target in internal_refs
            if not (source_in or target_in):
                continue

            if source_in and target_in:
                self._copy_link(child, link)
                continue

            new_source = link.source
            new_target = link.target
            if link.source in focal_refs:
                new_source = yield_proc.key
            if (link.target in focal_refs) and link.type == LinkType.CONSUMPTION:
                new_target = consume_proc.key

            self._ensure_ref_node_in_child(child, new_source)
            self._ensure_ref_node_in_child(child, new_target)
            self._copy_link(child, link, source_ref=new_source, target_ref=new_target)
        return child, consume_proc, yield_proc, descendants

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "key": self.key,
                "name": self.name,
                "parent": self.parent,
                "focalNode": self.focal_node,
                "nodes": [node.to_dict() for node in self.nodes],
                "links": [link.to_dict() for link in self.links],
                "groups": [group.to_dict() for group in self.groups],
            }
        )


class AuthoringProject:
    def __init__(self, *, meta: Optional[JsonDict] = None) -> None:
        self.meta = meta or {}
        self.diagrams: List[OpdDiagram] = []
        self._sd = self.add_diagram(key="sd", name="SD")

    def _unique_diagram_key(self, base: str) -> str:
        used = {diagram.key for diagram in self.diagrams}
        candidate = base
        index = 2
        while candidate in used:
            candidate = f"{base}-{index}"
            index += 1
        return candidate

    def add_diagram(
        self,
        *,
        key: Optional[str] = None,
        name: str,
        parent: Optional[str] = None,
        focal_node: Optional[str] = None,
    ) -> OpdDiagram:
        diagram_key = key or self._unique_diagram_key(_slugify(name, "diagram"))
        if any(existing.key == diagram_key for existing in self.diagrams):
            raise ValueError(f"Diagram key already exists: {diagram_key}")
        diagram = OpdDiagram(self, key=diagram_key, name=name, parent=parent, focal_node=focal_node)
        self.diagrams.append(diagram)
        return diagram

    def get_sd(self) -> OpdDiagram:
        return self._sd

    def getSD(self) -> OpdDiagram:
        return self.get_sd()

    def to_dict(self) -> JsonDict:
        return _clean_none(
            {
                "format": "opcloud-authoring",
                "version": 1,
                "meta": self.meta,
                "diagrams": [diagram.to_dict() for diagram in self.diagrams],
            }
        )

    def save(self, path: Union[str, Path]) -> None:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(self.to_dict(), handle, indent=2, ensure_ascii=False)
            handle.write("\n")


def opmObj(name: str, **kwargs: Any) -> OpmObject:
    """Shortcut constructor for an OPM object.

    Common fields:
    - `name`: display label shown in OPCloud
    - `key`: stable authoring identity; defaults to a slug of `name`
    - `style`: preferred way to specify OPM essence/affiliation
    - `position` / `size`: optional explicit geometry
    - `parent`: optional embedding parent node key in the same OPD
    """
    return OpmObject(name, **kwargs)


def opmProc(name: str, **kwargs: Any) -> OpmProcess:
    """Shortcut constructor for an OPM process.

    `name` is the visible label. For process naming in OPM, a gerund like
    `"Toast Making"` or `"Request Handling"` is usually clearer.
    """
    return OpmProcess(name, **kwargs)

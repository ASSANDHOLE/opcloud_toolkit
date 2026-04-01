# Python OPD Builder Authoring Format

This is the intermediate JSON format used by [`python_opd_builder`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder).

It is meant to be:

- stable across repeated saves
- easier for humans or AI to edit than raw OPCloud export JSON
- expressive enough to compile back into OPCloud-importable JSON

## Conversion Flow

- [`export_to_authoring.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/export_to_authoring.py):
  importable/export JSON -> authoring JSON
- [`build_importable.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/build_importable.py):
  authoring JSON -> importable JSON
- [`authoring.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/authoring.py):
  Python API -> authoring JSON

## Top-Level Shape

```json
{
  "format": "opcloud-authoring",
  "version": 1,
  "meta": {},
  "diagrams": []
}
```

Fields:

- `format`: always `"opcloud-authoring"`
- `version`: current authoring schema version
- `meta`: optional free-form metadata
- `diagrams`: list of OPDs

## Diagram Shape

Each diagram looks like:

```json
{
  "key": "sd",
  "name": "SD",
  "parent": null,
  "focalNode": null,
  "nodes": [],
  "links": [],
  "groups": []
}
```

Fields:

- `key`: stable diagram identifier
- `name`: diagram display name
- `parent`: parent diagram key, or `null` for root
- `focalNode`: focal node key in the parent diagram for unfold/in-zoom children
- `nodes`: objects and processes in this OPD
- `links`: procedural links
- `groups`: fundamental groups

## Node Shape

Objects and processes share the same base structure:

```json
{
  "key": "customer",
  "name": "Customer",
  "kind": "object",
  "parent": null,
  "position": { "x": 120, "y": 120 },
  "size": { "width": 135, "height": 60 },
  "attributes": {
    "essence": 0,
    "affiliation": 0,
    "statesArrange": "bottom"
  },
  "states": []
}
```

Fields:

- `key`: stable node identifier inside the diagram
- `name`: visible label
- `kind`: `"object"` or `"process"`
- `parent`: parent node key if this node is embedded in another node
- `position`: top-left visual position
- `size`: visual size
- `attributes.essence`: optional OPM essence value
- `attributes.affiliation`: optional OPM affiliation value
- `attributes.statesArrange`: optional object state arrangement direction
  - allowed values: `left`, `right`, `top`, `bottom`
- `states`: list of states for object nodes

## State Shape

States are nested under their owning object:

```json
{
  "key": "verified",
  "name": "Verified",
  "position": { "x": 180, "y": 200 },
  "size": { "width": 60, "height": 30 }
}
```

State refs in links or groups use:

```text
node-key/state-key
```

## Procedural Link Shape

```json
{
  "key": "customer-consumed",
  "kind": "procedural",
  "type": 2,
  "from": "customer/verified",
  "to": "checkout",
  "geometry": {
    "vertices": [],
    "labels": []
  }
}
```

Fields:

- `type`: numeric OPCloud link type
- `from`: source node or state ref
- `to`: target node or state ref
- `geometry`: optional visual geometry payload

## Fundamental Group Shape

```json
{
  "key": "customer-exhibition",
  "kind": "fundamental",
  "type": 12,
  "owner": "customer",
  "triangle": {
    "position": { "x": 200, "y": 180 },
    "size": { "width": 30, "height": 25 },
    "angle": 0
  },
  "ownerLinkGeometry": {
    "vertices": [],
    "labels": []
  },
  "members": [
    {
      "key": "verified-member",
      "to": "customer/verified",
      "type": 12,
      "geometry": {
        "vertices": [],
        "labels": []
      }
    }
  ]
}
```

## Builder Notes

- `AuthoringProject()` creates a root diagram named `SD`.
- `project.get_sd()` returns that root diagram.
- `addObject(...)` and `addProcess(...)` fill default position/size if omitted.
- `updateState(...)` / `add_state(...)` define object states.
- Objects with states default to `statesArrange="bottom"` unless explicitly set otherwise.
- `unfold(..., inherit=True)` and `inzoom(..., inherit=True)` can create child OPDs with inherited context.
- `deleteEndpoint(...)` removes nodes, states, and affected links/groups.

## Examples

See:

- [`build_example_opd.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_example_opd.py)
- [`build_complex_opd.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_complex_opd.py)

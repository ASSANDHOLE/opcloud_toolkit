#!/usr/bin/env python3
"""Simple example: making toast with a toaster, modeled on a single SD."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python_opd_builder.authoring import AuthoringProject, LinkType, OpmStyle, opmObj, opmProc
from python_opd_builder.build_importable import build_importable, dump_json


def build_example() -> AuthoringProject:
    project = AuthoringProject(meta={"name": "toast-making-on-sd"})
    sd = project.get_sd()

    make_toast = opmProc(
        "Toast Making",
        key="toast-making",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        position={"x": 430, "y": 190},
    )
    sd.addProcess(make_toast)

    toaster = opmObj(
        "Toaster",
        key="toaster",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        position={"x": 430, "y": 360},
        size={"width": 180, "height": 85},
    )
    toaster.updateState("off", "heating")
    sd.addObject(toaster)

    power_cord = sd.addObject(
        "Power Cord",
        key="power-cord",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        location={"x": 180, "y": 510},
    )
    heating_element = sd.addObject(
        "Heating Element",
        key="heating-element",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        location={"x": 650, "y": 510},
    )
    bread = sd.addObject(
        "Bread",
        key="bread",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        location={"x": 120, "y": 200},
    )
    toast = sd.addObject(
        "Toast",
        key="toast",
        style=OpmStyle.SYSTEMIC_PHYSICAL,
        location={"x": 740, "y": 200},
    )
    operator = sd.addObject(
        "Human Operator",
        key="human-operator",
        style=OpmStyle.ENVIRONMENTAL_PHYSICAL,
        location={"x": 120, "y": 360},
        size={"width": 165, "height": 70},
    )

    sd.addLink(LinkType.CONSUMPTION, bread, make_toast, key="bread-consumed")
    sd.addLink(LinkType.RESULT, make_toast, toast, key="toast-produced")
    sd.addLink(LinkType.CONSUMPTION, toaster.ref("off"), make_toast, key="toaster-off-consumed")
    sd.addLink(LinkType.RESULT, make_toast, toaster.ref("heating"), key="toaster-heating-produced")
    sd.addLink(LinkType.AGENT, operator, make_toast, key="operator-handles-making-toast")
    sd.addLink(
        LinkType.AGGREGATION,
        toaster,
        [power_cord, heating_element],
        key="toaster-aggregation",
    )

    return project


def main() -> None:
    tgt = ROOT / "example_exports"
    tgt.mkdir(parents=True, exist_ok=True)
    project = build_example()
    dump_json(tgt / "toast-making.importable.json", build_importable(project.to_dict()))


if __name__ == "__main__":
    main()

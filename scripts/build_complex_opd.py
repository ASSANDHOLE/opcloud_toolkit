#!/usr/bin/env python3
"""Complex example: a cleaner OPD for how the Codex app works."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python_opd_builder.authoring import AuthoringProject, LinkType, OpmStyle, opmObj, opmProc, NodeSpec
from python_opd_builder.build_importable import build_importable, dump_json

def pos(x, y):
    return {"x": x, "y": y}

def build_complex_example() -> AuthoringProject:
    project = AuthoringProject(meta={"name": "codex-app-workflow"})
    sd = project.get_sd()

    user = sd.addObject(
        "User",
        key="user",
        style=OpmStyle.ENVIRONMENTAL_PHYSICAL,
        location=pos(300,50),
    )
    user_request = sd.addObject(
        "User Request",
        key="user-request",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(300,200),
    )
    task_handling = sd.addProcess(
        "Task Handling",
        key="task-handling",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(500,200),
    )
    response = sd.addObject(
        "Response",
        key="response",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(700,200),
    )
    codex_app = sd.addObject(
        "Codex App",
        key="codex-app",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(300,350),
    )
    workspace = sd.addObject(
        "Workspace",
        key="workspace",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(500,350),
    )
    tooling_environment = sd.addObject(
        "Tooling Environment",
        key="tooling-environment",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(700,350),
    )

    sd.addLink(LinkType.EXHIBITION, user, [user_request], key="user-exhibits-request",
               triangle={"position": pos(352,143), "size": {"width": 30, "height": 25}, "angle": 0},)
    sd.addLink(LinkType.CONSUMPTION, user_request, task_handling, key="request-consumed")
    sd.addLink(LinkType.RESULT, task_handling, response, key="response-yielded")
    sd.addLink(LinkType.INSTRUMENT, codex_app, task_handling, key="app-instruments-task-handling")
    sd.addLink(LinkType.INSTRUMENT, workspace, task_handling, key="workspace-instruments-task-handling")
    sd.addLink(LinkType.INSTRUMENT, tooling_environment, task_handling, key="tools-instrument-task-handling")

    ##################################################
    ######### In-Zoom on "SD.Task Handling" ##########
    ##################################################
    task_handling_opd, context_building, response_composing, desc = sd.inzoom(
        "task-handling", key="task-handling-opd", name="Task Handling",
        first_process_name="Context Building", last_process_name="Response Composing",
    )
    task_handling = task_handling_opd.find_node_by_name("Task Handling")
    # We plan to have 4 vertically arranged sub-processes, each with default 60 height
    task_handling.position = pos(300, 300)
    task_handling.size = {"width": 525, "height": 620}
    context_building.position = pos(505, 450)
    response_composing.position = pos(505, 810)
    codex_app = task_handling_opd.find_node_by_name("Codex App")
    codex_app.position = pos(200, 100)
    workspace = task_handling_opd.find_node_by_name("Workspace")
    workspace.position = pos(355,100)
    tooling_environment = task_handling_opd.find_node_by_name("Tooling Environment")
    tooling_environment.position = pos(510,100)
    user_request = task_handling_opd.find_node_by_name("User Request")
    user_request.position = pos(670,200)
    response = task_handling_opd.find_node_by_name("Response")
    response.position = pos(600,950)
    prompt_context = task_handling_opd.addObject(
        "Prompt Context",
        key="prompt-context",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        parent="task-handling",
        location=pos(340,510),
    )
    plan = task_handling_opd.addObject(
        "Plan",
        key="plan",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        parent="task-handling",
        location=pos(670,630),
    )
    tool_results = task_handling_opd.addObject(
        "Tool Results",
        key="tool-results",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        parent="task-handling",
        location=pos(340,750),
    )

    reasoning = task_handling_opd.addProcess(
        "Reasoning",
        key="reasoning",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        parent="task-handling",
        location=pos(505,570),
    )
    tool_executing = task_handling_opd.addProcess(
        "Tool Executing",
        key="tool-executing",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        parent="task-handling",
        location=pos(505,690),
    )

    task_handling_opd.addLink(LinkType.RESULT, context_building, prompt_context, key="context-yields-prompt")
    task_handling_opd.addLink(LinkType.CONSUMPTION, prompt_context, reasoning, key="context-consumed-by-reasoning")
    task_handling_opd.addLink(LinkType.RESULT, reasoning, plan, key="reasoning-yields-plan")
    task_handling_opd.addLink(LinkType.CONSUMPTION, plan, tool_executing, key="plan-consumed-by-tool-executing")
    task_handling_opd.addLink(LinkType.RESULT, tool_executing, tool_results, key="tools-yield-results")
    task_handling_opd.addLink(LinkType.CONSUMPTION, tool_results, response_composing, key="tools-yield-response")

    ##################################################
    ############ Unfold on "SD.Codex App" ############
    ##################################################
    codex_app_opd, desc = sd.unfold("codex-app", key="codex-app-opd", name="Codex App")
    codex_app = codex_app_opd.find_node_by_name("Codex App")
    codex_app.position = pos(270,200)
    task_handling = codex_app_opd.find_node_by_name("Task Handling")
    if task_handling:
        task_handling.position = pos(270,100)
    conversation_ui = codex_app_opd.addObject(
        "Conversation UI",
        key="conversation-ui",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(0,300),
    )
    model_runtime = codex_app_opd.addObject(
        "Model Runtime",
        key="model-runtime",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(180,300),
    )
    tool_orchestrator = codex_app_opd.addObject(
        "Tool Orchestrator",
        key="tool-orchestrator",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(180,400),
    )
    file_editor = codex_app_opd.addObject(
        "File Editor",
        key="file-editor",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(0,400),
    )
    terminal_bridge = codex_app_opd.addObject(
        "Terminal Bridge",
        key="terminal-bridge",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(90,500),
    )
    conversation_thread = codex_app_opd.addObject(
        "Conversation Thread",
        key="conversation-thread",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(540,300),
    )
    current_plan = codex_app_opd.addObject(
        "Current Plan",
        key="current-plan",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(450,400),
    )
    diff_preview = codex_app_opd.addObject(
        "Diff Preview",
        key="diff-preview",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(360,300),
    )

    codex_app_opd.addLink(
        LinkType.AGGREGATION,
        "codex-app",
        [conversation_ui, model_runtime, tool_orchestrator, file_editor, terminal_bridge],
        key="codex-app-aggregation",
        triangle={"position": pos(142,241), "size": {"width": 30, "height": 25}, "angle": 0},
    )
    codex_app_opd.addLink(
        LinkType.EXHIBITION,
        "codex-app",
        [conversation_thread, current_plan, diff_preview],
        key="codex-app-exhibition",
        triangle={"position": pos(503, 241), "size": {"width": 30, "height": 25}, "angle": 0}
    )

    #####################################################
    #### Unfold on "SD.Codex App.Tool Orchestrator" #####
    #####################################################
    tool_orchestrator_opd, desc = codex_app_opd.unfold(
        "tool-orchestrator",
        key="tool-orchestrator-opd",
        name="Tool Orchestrator",
    )
    tool_orchestrator = tool_orchestrator_opd.find_node_by_name("Tool Orchestrator")
    tool_orchestrator.position = pos(250,180)
    codex_app = tool_orchestrator_opd.find_node_by_name("Codex App")
    if codex_app:
        codex_app.position = pos(250,50)
    shell_runner = tool_orchestrator_opd.addObject(
        "Shell Runner",
        key="shell-runner",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(150,300),
    )
    file_patcher = tool_orchestrator_opd.addObject(
        "File Patcher",
        key="file-patcher",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(350,400),
    )
    resource_reader = tool_orchestrator_opd.addObject(
        "Resource Reader",
        key="resource-reader",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(150,400),
    )
    test_runner = tool_orchestrator_opd.addObject(
        "Test Runner",
        key="test-runner",
        style=OpmStyle.SYSTEMIC_INFORMATICAL,
        location=pos(350,300),
    )
    tool_orchestrator_opd.addLink(
        LinkType.AGGREGATION,
        "tool-orchestrator",
        [shell_runner, file_patcher, resource_reader, test_runner],
        key="tool-orchestrator-aggregation",
        triangle={"position": pos(303, 267), "size": {"width": 30, "height": 25}, "angle": 0},
    )
    codex_aggregate_tool = tool_orchestrator_opd.find_group_by_owner(codex_app)
    expected_child_set = {tool_orchestrator_opd._node_key(tool_orchestrator)}
    for ch in codex_aggregate_tool:
        if set([m.key for m in ch.members]) == expected_child_set:
            ch.triangle = {"position": pos(303, 131), "size": {"width": 30, "height": 25}}
            break

    return project


def main() -> None:
    tgt = ROOT / "example_exports"
    tgt.mkdir(parents=True, exist_ok=True)
    project = build_complex_example()
    dump_json(tgt / "codex-app.importable.json", build_importable(project.to_dict()))


if __name__ == "__main__":
    main()

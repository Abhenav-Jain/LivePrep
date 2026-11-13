import uuid
import pytest
from tools import (
    save_note_impl,
    score_answer_impl,
    get_progress_impl,
    get_gemini_tools,
    TOOL_DISPATCHER,
)


def test_allowed_tools_registered():
    """Ensure only mock-interviewer coaching tools are in TOOL_DISPATCHER."""
    expected_tools = {"search_web", "save_note", "score_answer", "get_progress"}
    assert set(TOOL_DISPATCHER.keys()) == expected_tools


def test_dangerous_tools_not_in_dispatcher():
    """Ensure dangerous tools are completely deleted."""
    dangerous = {
        "execute_command",
        "read_file",
        "write_file",
        "list_directory",
        "get_system_telemetry",
    }
    for tool_name in dangerous:
        assert tool_name not in TOOL_DISPATCHER


def test_gemini_tools_declarations():
    """Verify Gemini tool declarations only contain the kept tools."""
    tools = get_gemini_tools()
    assert len(tools) == 1
    func_names = {decl.name for decl in tools[0].function_declarations}
    assert func_names == {"search_web", "save_note", "score_answer", "get_progress"}


def test_data_dir_and_db_created():
    """Verify DATA_DIR configuration and SQLite persistence."""
    test_session = f"test-session-{uuid.uuid4()}"

    note_res = save_note_impl(test_session, "communication", "Good eye contact and clear pacing.")
    assert note_res["status"] == "success"

    score_res = score_answer_impl(test_session, "Tell me about yourself", "My background is in Python.", 90)
    assert score_res["status"] == "success"
    assert score_res["score"] == 90

    prog_res = get_progress_impl(test_session)
    assert prog_res["status"] == "success"
    assert prog_res["session_id"] == test_session
    assert prog_res["notes"]["communication"] == "Good eye contact and clear pacing."
    assert len(prog_res["scores"]) == 1
    assert prog_res["scores"][0]["score"] == 90
    assert prog_res["average_score"] == 90.0


def test_no_dangerous_imports():
    """Verify dangerous libraries are not imported in tools."""
    import tools
    assert "subprocess" not in dir(tools)
    assert "shlex" not in dir(tools)
    assert "signal" not in dir(tools)
    assert "safe_path" not in dir(tools)
    assert "_is_protected" not in dir(tools)
    assert "PROTECTED_PATTERNS" not in dir(tools)
    assert "ALLOWED_COMMANDS" not in dir(tools)
    assert "WORKSPACE_ROOT" not in dir(tools)

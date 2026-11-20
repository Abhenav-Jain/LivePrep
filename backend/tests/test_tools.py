"""The model gets no tools: no shell, no files, no web search, no notes."""
import tools


def test_no_tools_are_registered():
    assert tools.TOOL_DISPATCHER == {}
    assert tools.get_gemini_tools() == []


def test_dangerous_tools_not_present():
    dangerous = {
        "execute_command", "read_file", "write_file", "list_directory",
        "get_system_telemetry", "search_web", "save_note", "score_answer", "get_progress",
    }
    assert not dangerous & set(tools.TOOL_DISPATCHER)


def test_tools_module_has_no_shell_or_sqlite_code():
    source = open(tools.__file__, encoding="utf-8").read()
    for word in ("subprocess", "sqlite3", "os.system"):
        assert word not in source

"""The idle monitor warns the user before ending an inactive session."""
import asyncio
import time

from gemini_live import GeminiLiveBridge


def make_bridge(idle_timeout=1.0):
    bridge = GeminiLiveBridge(api_key="test_key")
    bridge.idle_timeout_seconds = idle_timeout
    bridge.idle_warning_seconds = 30  # capped to half of the timeout for short timeouts
    bridge._monitor_interval = 0.05
    return bridge


def run_monitor(bridge, last_activity, messages, on_message=None, limit=5.0):
    async def ws_send(data):
        messages.append(data)
        if on_message:
            on_message(data)

    async def runner():
        await asyncio.wait_for(bridge._monitor_session_timeouts(ws_send, last_activity), timeout=limit)

    asyncio.run(runner())


def statuses(messages):
    return [m["status"] for m in messages if m.get("type") == "session_status"]


def test_warns_then_ends_when_user_stays_silent():
    bridge, messages = make_bridge(1.0), []
    run_monitor(bridge, [time.monotonic()], messages)
    assert statuses(messages) == ["idle_warning", "ended"]
    assert "inactivity" in messages[-1]["message"]
    assert bridge._session_closed is True


def test_user_speaking_again_cancels_the_warning():
    bridge, messages, activity = make_bridge(1.0), [], [time.monotonic()]

    def on_message(data):
        if data.get("status") == "idle_warning":
            activity[0] = time.monotonic()  # the user spoke

    # Keep the user active after the warning for a short while, then stop the monitor.
    async def ws_send(data):
        messages.append(data)
        on_message(data)

    async def runner():
        task = asyncio.create_task(bridge._monitor_session_timeouts(ws_send, activity))
        await asyncio.sleep(0.45)   # warning (at ~0.5 s) has not fired yet: speak now
        activity[0] = time.monotonic()
        await asyncio.sleep(0.4)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(runner())
    assert "ended" not in statuses(messages)


def test_resumed_message_after_warning_when_user_talks_again():
    bridge, messages, activity = make_bridge(2.0), [], [time.monotonic()]

    async def ws_send(data):
        messages.append(data)
        if data.get("status") == "idle_warning":
            activity[0] = time.monotonic()

    async def runner():
        task = asyncio.create_task(bridge._monitor_session_timeouts(ws_send, activity))
        await asyncio.sleep(1.6)    # warning fires at ~1.0 s, user "speaks", monitor sends "resumed"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(runner())
    seen = statuses(messages)
    assert seen[:2] == ["idle_warning", "resumed"]
    assert "ended" not in seen


def test_default_silence_threshold_is_lower_for_quiet_speakers(monkeypatch):
    monkeypatch.delenv("AUDIO_SILENCE_RMS_THRESHOLD", raising=False)
    assert GeminiLiveBridge(api_key="k").silence_rms_threshold == 100.0

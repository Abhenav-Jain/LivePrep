import os
import json
import base64
import asyncio
import logging
from typing import Optional, Callable
from google import genai
from google.genai import types
from tools import get_gemini_tools, TOOL_DISPATCHER

logger = logging.getLogger("omni-copilot-live")

SYSTEM_INSTRUCTION = """
You are OmniCopilot Live, an ultra-intelligent, low-latency multimodal voice and vision co-pilot.
You have real-time access to the user's microphone, live screen/camera video stream, and local development environment.
You can see what the user is doing on their screen, answer questions naturally, concisely, and conversationally via voice, and execute tools asynchronously.
You have tools to:
- execute safe terminal commands (`execute_command`)
- read files in the project (`read_file`)
- write or edit code files (`write_file`)
- list files and folders (`list_directory`)
- search the web in real-time (`search_web`)
- get system telemetry (`get_system_telemetry`)

Key Behavioral Principles:
1. Be concise, fast, and natural in spoken conversation. Don't speak long walls of text.
2. Use tools proactively when the user asks you to build, test, fix, inspect code, or look up information.
3. If the user shares their screen, observe what's visible (code editors, terminal errors, web pages, designs) and give direct, context-aware answers.
4. Adapt naturally to English, Hindi, or Hinglish based on what the user speaks.
""".strip()

class GeminiLiveBridge:
    def __init__(self, api_key: str, model: str = "gemini-3.8-live"):
        self.api_key = api_key
        self.model = model
        self.client = genai.Client(api_key=api_key)
        self.active_tool_tasks: set[asyncio.Task] = set()

    async def run_session(self, ws_send: Callable[[dict], asyncio.Future], ws_receive: Callable[[], asyncio.Future]):
        """
        Bridges the frontend client WebSocket with the Gemini Live API bi-directional WebSocket session.
        Equipped with Context Window Compression, Low-Latency VAD, and Decoupled Async Tool Execution.
        """
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                    silence_duration_ms=250, # Sub-second ultra low latency turn detection
                    prefix_padding_ms=20,
                )
            ),
            # Sliding Window context compression prevents session expiration
            context_window_compression=types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow()
            ),
            tools=get_gemini_tools(),
        )

        logger.info(f"Connecting to Gemini Live API with model: {self.model}")
        await ws_send({"type": "session_status", "status": "connecting", "message": f"Connecting to {self.model}..."})

        try:
            async with self.client.aio.live.connect(model=self.model, config=config) as session:
                await ws_send({"type": "session_status", "status": "connected", "message": "Live Session Active!"})

                send_task = asyncio.create_task(self._client_to_gemini(session, ws_receive))
                recv_task = asyncio.create_task(self._gemini_to_client(session, ws_send))

                done, pending = await asyncio.wait(
                    [send_task, recv_task],
                    return_when=asyncio.FIRST_COMPLETED
                )

                for task in pending:
                    task.cancel()

        except Exception as e:
            logger.error(f"Gemini Live session error: {e}", exc_info=True)
            await ws_send({"type": "error", "message": str(e)})
        finally:
            # Clean up any remaining background tool tasks
            for task in list(self.active_tool_tasks):
                task.cancel()
            self.active_tool_tasks.clear()
            await ws_send({"type": "session_status", "status": "disconnected", "message": "Session closed."})

    async def _client_to_gemini(self, session, ws_receive):
        """Streams audio, video frames, and text from the client to Gemini."""
        while True:
            try:
                raw_msg = await ws_receive()
                if raw_msg is None:
                    break

                if isinstance(raw_msg, str):
                    msg = json.loads(raw_msg)
                elif isinstance(raw_msg, dict):
                    msg = raw_msg
                else:
                    continue

                msg_type = msg.get("type")

                if msg_type == "audio":
                    audio_bytes = base64.b64decode(msg["data"])
                    await session.send_realtime_input(
                        audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                    )

                elif msg_type == "video":
                    jpeg_bytes = base64.b64decode(msg["data"])
                    await session.send_realtime_input(
                        video=types.Blob(data=jpeg_bytes, mime_type="image/jpeg")
                    )

                elif msg_type == "text":
                    text = msg.get("text", "")
                    if text:
                        await session.send_realtime_input(text=text)

                elif msg_type == "audio_stream_end":
                    # Hybrid VAD signal from client silence detector
                    await session.send_realtime_input(audio_stream_end=True)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error handling client message: {e}")
                break

    async def _gemini_to_client(self, session, ws_send):
        """
        Streams audio, transcription, and tool execution from Gemini back to the client.
        Tool executions are fully decoupled to ensure session.receive() is never blocked.
        """
        while True:
            try:
                async for response in session.receive():
                    status = getattr(response, "interaction_status", None)
                    if status:
                        await ws_send({"type": "interaction_status", "status": str(status)})

                    # 1. Server Content (Audio, Transcriptions, Interruption)
                    content = response.server_content
                    if content:
                        # Interruption: Client immediately flushes speaker audio buffer
                        if content.interrupted:
                            await ws_send({"type": "interrupted"})

                        # User's recognized speech transcript
                        if content.input_transcription and content.input_transcription.text:
                            await ws_send({
                                "type": "user_transcription",
                                "text": content.input_transcription.text
                            })

                        # Assistant's speech transcript
                        if content.output_transcription and content.output_transcription.text:
                            await ws_send({
                                "type": "agent_transcription",
                                "text": content.output_transcription.text
                            })

                        # 24kHz PCM Audio Chunks
                        if content.model_turn and content.model_turn.parts:
                            for part in content.model_turn.parts:
                                if part.inline_data and part.inline_data.data:
                                    audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                    await ws_send({
                                        "type": "audio",
                                        "data": audio_b64,
                                        "sample_rate": 24000
                                    })

                    # 2. Asynchronous Non-Blocking Tool Calls (Decoupled execution)
                    if response.tool_call and response.tool_call.function_calls:
                        for call in response.tool_call.function_calls:
                            # Launch tool in a decoupled background task so session.receive() never waits
                            task = asyncio.create_task(
                                self._execute_tool_async(session, ws_send, call)
                            )
                            self.active_tool_tasks.add(task)
                            task.add_done_callback(self.active_tool_tasks.discard)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in Gemini receive loop: {e}", exc_info=True)
                break

    async def _execute_tool_async(self, session, ws_send, call):
        """Executes a single tool asynchronously in a worker thread and replies to Gemini."""
        call_id = call.id
        name = call.name
        args = call.args or {}

        logger.info(f"Asynchronous tool started: {name} (id: {call_id}) with args: {args}")
        await ws_send({
            "type": "tool_started",
            "call_id": call_id,
            "name": name,
            "args": args
        })

        tool_func = TOOL_DISPATCHER.get(name)
        if tool_func:
            try:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, tool_func, args)
            except Exception as e:
                result = {"status": "error", "error": str(e)}
        else:
            result = {"status": "error", "error": f"Tool '{name}' is not recognized."}

        logger.info(f"Asynchronous tool {name} finished. Sending response back to Gemini.")
        await ws_send({
            "type": "tool_completed",
            "call_id": call_id,
            "name": name,
            "result": result
        })

        try:
            resp = types.FunctionResponse(
                id=call_id,
                name=name,
                response={"result": result}
            )
            await session.send_tool_response(function_responses=[resp])
        except Exception as e:
            logger.error(f"Failed to send tool response to Gemini: {e}")

# RoomLilt demo video

This tooling produces an English 1280×800 demonstration from real browser interactions, with separately synthesized narrator and assistant voices. The submitted cut, `video/demo-assistant.mp4`, is 137.6 seconds (steps 1–7 below); the final builder rejects a video at or above 180 seconds. No third-party music, footage, or logos are used.

## Commands, in order

Run from the project root on macOS. Node 22 and the project's installed dependencies are required. The recorder starts and stops its own server and Vite instance; ports 3001 and 5173 must be unused. Stop an existing development session first. It uses a fresh `video/raw/household-<uuid>.json` file and resets only that fictional dataset.

```sh
# 1. Synthesize all lines and measure the actual audio clips.
npm run video:synth

# 2. Validate the ordered storyboard and measured audio holds without a browser.
npm run video:record -- --check

# 3. Record actual interactions using the project-local Chromium installation.
npm run video:record

# 4. Validate the completed recording and audio manifests without encoding.
npm run video:build -- --validate

# 5. Assemble title, recording, voices, and end card; print and enforce duration.
npm run video:build

# 6. Independently inspect the final file's codecs, dimensions and duration.
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of json video/demo.mp4
```

The recorder uses a project-local Chromium under `data/browser-cache`. If it is missing, prepare it before step 3 with `PLAYWRIGHT_BROWSERS_PATH=./data/browser-cache npx playwright install chromium`. This command downloads browser binaries; it is not run by the recorder. Browser smoke tests, separately: `npm run test:browser`. The recording is headless, so it does not open a human browser window.

## Existing-assistant scene (used in the submitted cut)

```sh
# 7. After step 5: add a scene in which Claude Code calls the same server.
npm run video:assistant
```

`scripts/add-assistant-scene.ts` copies the recorder's final fictional data file, starts the MCP server on port 3011, and runs `claude -p` once with a one-off `--mcp-config` file (the assistant's saved configuration is not changed). It keeps the raw stream-json output in `video/raw/assistant.jsonl`, fails unless Claude Code connected and read the household state and ledger, and renders the prompt, actual tool calls, and answer as a 1280×800 card. A Tom (Enhanced) narration line is added, and the scene is inserted in the pause before the closing segment. The result is `video/demo-assistant.mp4`; `video/demo.mp4` is unchanged. This step needs the `claude` CLI and its sign-in.

## Audio prerequisites and outputs

`video/narration.json` is the ordered source for both voices and the UI action description. Both voices use macOS speech synthesis. The narrator uses `say -v "Tom (Enhanced)" -o <output.aiff> <text>`; set `NARRATOR_MAC_VOICE` to use another installed voice. The script stops before writing a timeline if the narrator voice is not installed. Assistant lines use `say -v "Ava (Premium)"`, falling back to `Samantha` when unavailable or producing invalid/empty audio. Enhanced and Premium voices are added in System Settings > Accessibility > Spoken Content > System voice > Manage Voices; the script downloads nothing. ffmpeg and ffprobe must be on PATH. Judges do not need any voice to run the application.

`video/audio/` contains source and normalized clips plus `timeline.json`. Clip durations come from ffprobe. Each segment places the narrator first and the assistant immediately afterward, followed by an 800 ms hold. Both voices target −18 LUFS with a −2 dB true-peak ceiling; the final mix is limited as well. Invalid or silent synthesis fails instead of substituting invented audio or silently emitting a ready timeline.

## Recording, synchronization, and assembly

`scripts/record-demo.ts` drives real suggestion chips and consent buttons, hovers deliberately, scrolls to important cards, reloads the client, and opens actual protocol messages. It checks the side-by-side plan headings, unchanged state after decline, preserved agreements after reload/repair, and exact assistant text before holding a scene for its synthesized audio duration. The repair changes Leo's meeting, so Leo is also the next member asked for consent; the script follows the actual solver rather than inventing another yielding member.

The recorder writes a raw WebM and `video/raw/segments.json`. A 32×32 pixel corner marker (sampling its center 8×8 pixels) anchors each segment to the encoded frames. After recording, ffmpeg decodes that corner and ffprobe supplies frame timestamps, so segment starts are measured from the actual recording rather than inferred from browser-launch latency. The manifest reports the encoded-frame timing resolution. The small marker remains in the raw and final frames; it carries no user data. The submitted video was synchronized this way from a real Chromium recording.

`build-video.sh` validates clip durations against disk, checks segment order/holds and frame size, then mixes the clips at those recorded starts. It adds a 2.5-second plain title card and 2.5-second disclaimer end card, using locally generated bitmap text because this Mac's ffmpeg has no drawtext filter. It can pad at most two seconds of missing final video with the last frame. It writes H.264/AAC to `video/demo.mp4` without upscaling. Subtitles are not added. Generated media, raw data and card intermediates are excluded from source control; keep `narration.json`, this README, and the scripts for reproducibility.

The script prints the final ffprobe duration and fails if it reaches 180 seconds. Interaction time is additional to the synthesized holds. If it is too long, shorten narration and repeat steps 1–5. Automated loudness checks do not establish pronunciation or listening quality, so listen to the finished voices.

## What the video shows

The submitted video, `video/demo-assistant.mp4`, was produced with steps 1–7: 137.6 seconds, 1280×800, H.264/AAC. Step 5 alone yields the 125.2-second `video/demo.mp4` without the assistant scene. A page reload in the video demonstrates a new MCP client connection; it is not presented as a server restart. Server-restart persistence is covered separately by `tests/process-restart.test.ts`. Nothing is uploaded by these commands.

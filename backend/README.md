# Automated Video Maker

Automated Video Maker is an open-source, local-first video production app. It turns a written script or topic into a narrated video with generated scenes, searched images, subtitles, and FFmpeg rendering. This repository is a monorepo: the frontend and backend are separate apps that communicate over HTTP and WebSocket.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Install](#install)
- [Configure](#configure)
- [Run locally](#run-locally)
- [Use the app](#use-the-app)
- [How generation works](#how-generation-works)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security and privacy](#security-and-privacy)
- [License and third-party services](#license-and-third-party-services)

## Features

- Documentary narration and multi-presenter discussion modes.
- Vertical 9:16 Shorts and landscape 16:9 video formats.
- Topic-to-script generation through Groq.
- Piper text-to-speech with configurable presenter voices.
- AI scene planning with a rule-based fallback.
- Image acquisition through DuckDuckGo image search, with cache, reuse, and placeholder fallback.
- SRT subtitles burned into video scenes.
- FFmpeg rendering and WebSocket progress/log updates.
- Local output files served by the backend.

## Architecture

```text
.
├── backend/
│   ├── src/routes/       HTTP routes for topic scripts and voice utilities
│   ├── src/services/     TTS, planning, image search, subtitles, rendering, pipeline
│   ├── src/websocket/    generation requests and progress events
│   ├── models/           local Piper voice files (not committed)
│   └── output/           rendered videos (not committed)
└── frontend/
    ├── app/              Next.js app entry points and global styles
    ├── components/       script/topic inputs, selectors, status, preview
    └── lib/               WebSocket progress client
```

The browser uses WebSocket on the backend origin for video generation. Topic script generation and voice routes use the backend HTTP API. The frontend Next.js config also proxies `/api` to `http://localhost:3002` for local development.

## Requirements

- Node.js 20 or newer (Node 22 also works).
- pnpm is recommended; npm can be run separately in each app.
- FFmpeg and `ffprobe` available on `PATH`.
- Piper executable and matching Piper `.onnx` voice model files.
- Groq API key for topic scripts, AI scene planning, and dialogue conversion.
- Internet access for Groq and image search. Video assembly and Piper speech synthesis run locally, but the complete application is not fully offline.

## Install

Clone the repository, then install each app's dependencies:

```bash
git clone <repository-url>
cd <repository-directory>
cd backend && pnpm install
cd ../frontend && pnpm install
```

Install FFmpeg using your OS package manager and verify both commands:

```bash
ffmpeg -version
ffprobe -version
```

Install Piper for your operating system and download compatible voice models into `backend/models/`. Model filenames must match configured voice IDs. The default IDs are `en_US-ryan-high`, `en_US-lessac-high`, `en_US-joe-medium`, and `en_US-amy-high`; set the environment variables below if you use different models.

## Configure

Create `backend/.env`:

```env
PORT=3002
GROQ_API_KEY=your_groq_api_key
PIPER_BIN=/usr/local/bin/piper
PIPER_LIB_PATH=
USE_AI_SCENE_PLANNING=true
SCENES_PER_GROUP=2

# Optional presenter voice IDs (must match files in backend/models)
VOICE_STEVE=en_US-ryan-high
VOICE_STORM=en_US-lessac-high
VOICE_STONE=en_US-joe-medium
VOICE_ATLAS=en_US-amy-high
```

For a frontend opened from another machine or served behind a proxy, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
```

Set it to the backend's browser-reachable base URL. Use `https://` when the frontend is served over HTTPS; the client selects `wss://` automatically in that case. Restart the frontend after changing this value.

Do not commit `.env`, API keys, voice models, generated videos, temporary files, or downloads. These are intended to stay local and are ignored by Git.

## Run locally

Start each app in its own terminal from the repository root:

```bash
cd backend && pnpm dev
```

```bash
cd frontend && pnpm dev
```

By default, open [http://localhost:3000](http://localhost:3000). The backend listens on port `3002`. To create a production backend build, run `pnpm build` in `backend`, then `pnpm start`. The frontend supports `pnpm build` and `pnpm start` as well.

## Use the app

1. Choose **Script Mode** to enter or paste narration, or **Topic Mode** to draft a script with Groq.
2. Choose **Documentary** for one narrator or **Discussion Panel** for dialogue presenters.
3. Select Shorts (vertical) or long-form (landscape).
4. Generate and keep the browser connection open while progress is reported.
5. Preview or download the finished MP4.

Topic mode currently exposes a 0.5–60 minute target range. Actual output length depends on Groq's response limits and generated word count; treat this range as a prompt target, not a guaranteed runtime.

## How generation works

1. The frontend sends the script, format, and mode over WebSocket.
2. Discussion scripts are parsed or converted into speaker-tagged dialogue; documentary scripts use one narrator.
3. Piper creates local speech audio. Missing models or TTS errors are surfaced as generation errors.
4. The backend splits/plans scenes and searches for images. Image search currently uses DuckDuckGo; Pexels is not currently integrated.
5. Subtitles are generated and FFmpeg renders silent image scenes, combines them, and overlays the audio.
6. The backend sends a completion event with the URL under `/output`.

Generation uses a WebSocket job tied to the connected browser. If the browser disconnects, the render may finish but progress notifications cannot be delivered to that client.

## Troubleshooting

- **Port already in use:** stop the process using port 3000 or 3002, or configure another `PORT` for the backend and update the frontend URL/proxy accordingly.
- **Frontend cannot connect:** check the backend is running, `NEXT_PUBLIC_API_URL` is browser-accessible, and `http`/`https` matches `ws`/`wss`.
- **Topic generation or AI scene planning fails:** check `GROQ_API_KEY` and network access. Rule-based scene splitting is available by setting `USE_AI_SCENE_PLANNING=false`.
- **Piper model not found:** ensure the model file exists in `backend/models` and the configured voice ID exactly matches its filename without `.onnx`.
- **Piper executable/library error:** check `PIPER_BIN` and, when needed, `PIPER_LIB_PATH`.
- **FFmpeg/ffprobe errors:** install both tools and confirm they are available on `PATH` in the server process environment.
- **Images are generic or unavailable:** image search results depend on query quality, network access, and third-party availability; the pipeline may reuse a cached image or use a placeholder.
- **Slow or memory-heavy renders:** reduce scene count with `SCENES_PER_GROUP` or use shorter scripts and fewer generated scenes.

## Contributing

Contributions are welcome. Keep frontend changes in `frontend/` and backend changes in `backend/`. For changes spanning the WebSocket or HTTP contract, update both ends and document the message/API shape.

1. Fork the repository and create a focused branch.
2. Install dependencies and configure local tools/API keys.
3. Make a focused change with clear commit messages.
4. Run `pnpm build` in both `backend` and `frontend` before opening a pull request.
5. Describe the behavior changed, how it was checked, and include screenshots for UI changes where useful.

Do not include secrets, model weights, generated media, cache data, or temporary files in pull requests. For bugs, include reproduction steps, operating system, Node version, and relevant redacted logs. For larger changes, open an issue first to discuss the approach.

## Security and privacy

Scripts and topic prompts are sent to Groq when using AI features. Image queries are sent to the image search provider. Voice synthesis and FFmpeg rendering run locally. Do not expose the backend publicly without adding authentication, request limits, and appropriate network controls; the generation WebSocket currently accepts local requests without user authentication.

## License and third-party services

The project is distributed under the MIT License. Piper, Groq, FFmpeg, and DuckDuckGo image search are third-party tools/services and remain subject to their own licenses, terms, and availability. This application does not provide a guarantee of rights to images returned by search; review asset licensing before publication.

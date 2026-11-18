# Automated Video Maker — Frontend

This directory contains the browser interface for Automated Video Maker. It is a Next.js 14 and React application that lets users enter a script or generate one from a topic, choose a video format, follow generation progress, and preview/download the finished video.

For the complete project setup, backend configuration, architecture, and contribution guidance, see the [project README](../backend/README.md).

## Features

- Script input and AI topic-to-script workflow.
- Documentary and discussion presentation modes.
- Vertical Shorts and landscape long-form format selection.
- Live generation progress, status, and backend logs over WebSocket.
- Finished video preview and download.
- Responsive layout built with Tailwind CSS.

## Requirements

- Node.js 20 or newer.
- Backend server running and reachable from the browser for generation.
- Groq configuration on the backend for Topic Mode.

## Install and run

From this directory:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The backend defaults to port `3002`; start it separately by following the [project README](../backend/README.md#run-locally).

For a production build:

```bash
pnpm build
pnpm start
```

## Backend URL configuration

The frontend defaults to the same hostname on port `3002`. If the backend is hosted at another browser-accessible URL, create `.env.local` in this directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
```

Use the backend's HTTPS URL when the site is served over HTTPS. The app chooses `wss://` when the API URL uses HTTPS. Restart the development server after changing the value.

The Next.js development rewrite in `next.config.js` proxies `/api/*` to `http://localhost:3002/api/*` for local topic and utility API requests. If you change the backend host or port, update this rewrite as well as `NEXT_PUBLIC_API_URL`.

## User flow

1. Select Script Mode and enter narration, or choose Topic Mode and draft a script.
2. Choose Documentary or Discussion Panel.
3. Choose Shorts (9:16) or Long-form (16:9).
4. Start generation. Progress and logs arrive over WebSocket.
5. Preview and download the returned MP4.

Topic duration is a target sent to the backend, not a guarantee of final video runtime.

## Project structure

```text
app/
  page.tsx             Main screen and generation state
  layout.tsx           Root layout and metadata
  globals.css          Global styles
components/            Script, topic, selectors, progress, logs, preview
lib/websocket.ts       WebSocket connection and event handling
next.config.js         Local backend API rewrite
```

## Contributing

Keep frontend-specific changes in this directory. When changing an HTTP route, WebSocket URL, request shape, or event type, coordinate the change with `backend/` and update both sides. Before opening a pull request, run `pnpm build` here and follow the full repository contribution instructions in the [project README](../backend/README.md#contributing).

Do not commit `.env.local`, credentials, generated videos, or dependencies. Report UI bugs with reproduction steps and screenshots where practical.

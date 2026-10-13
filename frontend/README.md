# Deadlock Detection Simulator — Frontend

The frontend for the Deadlock Detection Simulator, built with Next.js, React, TypeScript, and Tailwind CSS.

It provides the interface for entering resource-allocation data, submitting a deadlock detection request, and viewing the backend's results.

## Tech Stack

- **Next.js** — React framework
- **React** — UI components
- **TypeScript** — type safety
- **Tailwind CSS** — styling
- **Flask** — Python backend API

## Prerequisites

- Node.js 20.9 or newer
- npm
- Python and Flask backend dependencies for running the complete application locally

## Getting Started

From the repository root:

```bash
cd frontend
npm install
cp .env.example .env.local
```

## Environment Variables

Configure the variables in `.env.local` as needed:

| Variable | Purpose |
|---|---|
| `FLASK_URL` | Backend URL used by the Next.js API rewrite. Defaults to `http://127.0.0.1:5001`. |
| `NEXT_PUBLIC_API_BASE_URL` | Optional API base URL used by browser requests. Leave empty to use the same-origin `/api` route. |

For local development, start the Flask backend in a separate terminal from the repository root:

```bash
source .venv/bin/activate
python app.py
```

Then start the frontend:

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Commands

Run these commands from the `frontend/` directory.

```bash
npm run dev
```

Starts the development server.

```bash
npm run lint
```

Runs ESLint.

```bash
npx tsc --noEmit
```

Checks TypeScript types without generating output files.

```bash
npm run build
```

Creates a production build.

```bash
npm run start
```

Serves the production build locally after running `npm run build`.

## API Integration

The frontend sends deadlock detection requests to:

```text
POST /api/detect
```

The request is forwarded to the Flask backend through the configured API route. The backend validates the submitted matrices and available-resource values, then returns the detection result.

## Project Structure

```text
frontend/
├── app/          # Next.js routes and global styles
├── components/   # Reusable UI components
├── lib/           # API integration and shared utilities
├── public/        # Static assets
├── package.json
└── next.config.ts
```

## Deployment

The intended deployment uses Vercel for the frontend and a separately hosted Python backend. Deployment configuration and live API connectivity must be verified before considering the application production-ready.

For backend setup, API details, testing, and deployment notes, see the [root README](../README.md).
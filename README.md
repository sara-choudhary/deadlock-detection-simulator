# Deadlock Detection Simulator

An interactive web application for learning and experimenting with the **multiple-instance deadlock detection algorithm** from Operating Systems.

The simulator lets users configure processes and resource types, enter allocation and outstanding-request matrices, and inspect the algorithm's result.

> **Project status:** The Next.js frontend and Flask backend are being prepared for deployment. Live deployment and production API connectivity must be verified before being marked complete.

## Features

- Configure the number of processes and resource types.
- Enter allocation, outstanding-request, and available-resource values.
- Run deadlock detection through the Flask backend.
- View the detection result and process classifications.
- Inspect the algorithm's execution trace and completion sequence when provided by the backend.
- Explore sample scenarios and test different resource configurations.
- Receive validation errors for invalid inputs.

Refer to the implementation for the exact features currently available.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| Backend | Python, Flask |
| Algorithm | Multiple-instance deadlock detection |
| Testing | pytest and frontend tooling |
| Deployment target | Vercel (configuration and production behavior pending verification) |

## How Deadlock Detection Works

The simulator implements **deadlock detection**, not Banker's deadlock avoidance algorithm.

The detection algorithm uses:

- **Available:** The number of currently available instances of each resource type.
- **Allocation:** The resources currently held by each process.
- **Request:** The additional resources each process is currently requesting.

The algorithm repeatedly identifies unfinished processes whose outstanding requests can be satisfied by the current `Work` vector. When a process can finish, its allocated resources are returned to `Work`. The algorithm stops when no further process can be selected.

Processes that remain unfinished are reported according to the detection algorithm's result.

Unlike Banker's algorithm, this is not a prediction about whether granting a future request will preserve a safe state. It examines the system's current allocation and outstanding requests.

## Architecture

The project contains two application layers:

1. **Next.js frontend** — provides the interactive user interface.
2. **Flask backend** — validates input and executes the deadlock detection algorithm.

The intended request flow is:

```text
User
  |
  v
Next.js frontend
  |
  v
POST /api/detect
  |
  v
Flask API
  |
  v
Input validation
  |
  v
Deadlock detection algorithm
  |
  v
JSON result
  |
  v
Frontend displays the result
```

The repository also retains the earlier Flask-served frontend under `templates/` and `static/`. The Next.js interface is the frontend intended for the redesigned deployment.

## Project Structure

```text
deadlock-detection-simulator/
├── api/
│   └── index.py
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── README.md
├── tests/
├── templates/
├── static/
├── app.py
├── deadlock.py
├── validation.py
├── requirements.txt
├── pytest.ini
├── .python-version
├── vercel.json
└── README.md
```

This is a high-level overview; the exact directory contents may vary as the project develops.

## Prerequisites

Install the following before running the application locally:

- Python compatible with the backend dependencies
- Node.js compatible with the installed Next.js version
- npm
- Git

## Local Setup

### 1. Start the Flask backend

From the repository root:

```bash
python -m venv .venv
```

Activate the virtual environment on macOS or Linux:

```bash
source .venv/bin/activate
```

Install backend dependencies:

```bash
python -m pip install -r requirements.txt
```

Start Flask:

```bash
python app.py
```

The current development configuration starts Flask at:

`http://127.0.0.1:5001`

Check the health endpoint:

```bash
curl http://127.0.0.1:5001/health
```

Expected response:

```json
{"status":"ok"}
```

### 2. Start the Next.js frontend

Open a second terminal and navigate to the frontend:

```bash
cd frontend
npm install
```

Create a local environment file from the example:

```bash
cp .env.example .env.local
```

The example configuration contains:

```dotenv
NEXT_PUBLIC_API_BASE_URL=
FLASK_URL=http://127.0.0.1:5001
```

With the public API base URL empty, the frontend is intended to use the Next.js API rewrite to reach Flask. Confirm that this proxy works in your local environment before relying on it in production.

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js, typically:

`http://localhost:3000`

Keep the Flask backend running while using the simulator.

## Backend API

### `GET /health`

Checks whether the Flask application is responding.

### `POST /api/detect`

Runs deadlock detection for a submitted system configuration.

The request uses JSON with these fields:

| Field | Purpose |
|---|---|
| `process_count` | Number of processes |
| `resource_count` | Number of resource types |
| `available` | Available-resource vector |
| `allocation` | Resource-allocation matrix |
| `request` | Outstanding-request matrix |

Example request structure:

```json
{
  "process_count": 2,
  "resource_count": 2,
  "available": [1, 0],
  "allocation": [[1, 0], [0, 1]],
  "request": [[0, 1], [1, 0]]
}
```

This example illustrates the request format; its output should be determined by the running implementation.

The API validates submitted data before running the algorithm. Errors use JSON responses with an error code and message. Depending on the error, the API can return statuses such as `400`, `405`, `413`, `415`, or `500`.

## Testing

### Backend tests

From the repository root, activate the Python virtual environment and run:

```bash
python -m pytest -v
```

### Frontend checks

From the `frontend/` directory, use the scripts defined in `package.json`. The following commands are commonly available, but verify that each script exists before running it:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Record actual test results only after running the commands. Do not treat a successful local build as proof of a successful production deployment.

## Deployment

The intended deployment uses separate Vercel projects from the same GitHub repository:

- **Frontend project:** root directory `frontend/`, using the Next.js framework.
- **Backend project:** repository root, using the Flask application through `api/index.py`.

Before production deployment, verify:

- The backend's Python runtime and dependency installation.
- That the Vercel Python function can import `app.py`, `deadlock.py`, and `validation.py`.
- That the backend deployment serves `/health` and `POST /api/detect`.
- That the frontend's `FLASK_URL` or other API configuration points to the deployed backend.
- That Next.js rewrites work correctly in production.
- That the deployed frontend can submit a configuration and display the actual backend result.

**Deployment status:** Pending verification. Do not consider the application deployed until both services are live and their integration has been tested.

## Troubleshooting

**The frontend cannot reach the backend**
- Ensure Flask is running locally.
- Check the environment variables and API rewrite configuration.
- Inspect the browser's Network panel and the backend logs.

**The backend fails to start**
- Activate the correct Python environment.
- Install dependencies from `requirements.txt`.
- Check import errors involving `app.py`, `deadlock.py`, or `validation.py`.

**The frontend build fails**
- Run the lint and TypeScript checks.
- Inspect the build error before changing dependencies or application code.

**Deployment fails**
- Review the Vercel build logs and function logs.
- Verify the project's root directory, Python runtime, dependencies, and environment variables.

## Scope and Limitations

This is an educational simulator. It models resource allocation and outstanding requests; it does not inspect or control real operating-system processes.

The deployment configuration and production integration are still being verified. Any unimplemented or unverified features should be confirmed against the current source code before being described as complete.

## License

No license has been specified yet. Add a license file if the project is intended for reuse or distribution.



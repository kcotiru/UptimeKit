# UptimeKit

UptimeKit is an enterprise HTTP monitor management and time-series performance analytics SaaS dashboard. It allows teams to configure endpoint targets for background health checks, ping latency profiling, and track uptime/downtime incidents.

## Architecture

UptimeKit is composed of three main layers:

1. **API Backend (`src/api`)**: An Express.js REST API that handles authentication, team management, and monitor configuration. It connects to a PostgreSQL database for persistent storage.
2. **Worker Engine (`src/worker`)**: A background service built with BullMQ and Redis. It schedules and executes high-concurrency HTTP/HTTPS health checks (pings) against user-configured endpoints and stores time-series metric results.
3. **Web Dashboard (`src/web`)**: A Next.js 14+ App Router frontend built with React, Tailwind CSS, and Recharts. It proxies authentication to the Express API, enforcing HttpOnly cookie session management and visualizing monitor performance via responsive time-series graphs.

---

## Prerequisites

To run UptimeKit locally, ensure you have the following installed and running:
- **Node.js** v20+
- **PostgreSQL** (running on default port 5432)
- **Redis** (running on default port 6379)

---

## Local Development Setup

Follow these steps to run the UptimeKit stack locally.

### 1. Environment Configuration

At the root directory, create a `.env` file for the backend components by copying the example:

```bash
cp .env.example .env
```
Ensure the `DATABASE_URL` and `REDIS_URL` in `.env` match your local setup. The defaults are:
```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/uptimekit_dev
REDIS_URL=redis://localhost:6379
```

Next, configure the frontend. Navigate to the `src/web` directory and create `.env.local`:
```bash
cd src/web
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:3000" > .env.local
echo "EXPRESS_INTERNAL_API_URL=http://localhost:3000" >> .env.local
```

### 2. Install Dependencies

Install dependencies for the backend (root) and the frontend (`src/web`):
```bash
# Root dependencies
npm install

# Web frontend dependencies
cd src/web
npm install
cd ../
```

### 3. Run Database Migrations

Set up your PostgreSQL database schema by running the migration script from the root directory:
```bash
npm run migrate
```

---

## Running the Services

To test the SaaS locally, you need to start the three primary services in separate terminal windows/tabs:

### Terminal 1: Start the API Server
Starts the Express REST API on `http://localhost:3000`.
```bash
npx ts-node src/api/server.ts
```

### Terminal 2: Start the Worker Engine
Starts the BullMQ job processor to actively ping health check endpoints.
```bash
npx ts-node src/worker/index.ts
```

### Terminal 3: Start the Web Dashboard
Starts the Next.js development server on `http://localhost:3001`.
```bash
cd src/web
npm run dev
```

---

## Usage

1. Open a browser and navigate to **[http://localhost:3001](http://localhost:3001)**.
2. Register a new team account at `/register`.
3. Once logged in, you will be redirected to the Dashboard.
4. Click **Add Monitor** to register an endpoint (e.g., `https://google.com` or your own API) to begin health tracking.
5. The Worker Engine will automatically begin pinging the target based on the configured interval. You can click into the monitor to view its real-time time-series performance graph.

# StorageTierRecoveryDesk

Find the money trapped in mis-tiered, over-retained, and snapshot-bloated cloud storage and turn it into a prioritized recovery plan.

StorageTierRecoveryDesk is a storage-specific cost-recovery analysis desk. It ingests cloud billing and usage exports (object storage, block volumes, snapshots, backups), enriches each asset with access-pattern signals, and computes the exact dollars recoverable per action: re-tier this bucket, delete this orphaned volume, prune this snapshot chain, tighten this retention policy. Every finding becomes a ranked line in a recovery worksheet with savings, effort, and risk, and the desk tracks realized savings as actions are marked done.

It is a read-only analysis and planning layer. It never mutates any storage. The actual moves happen in the cloud provider's own tools. Every dollar figure is deterministic and reproducible from the inputs and the versioned pricing book, so a FinOps analyst can defend the number in a cost review.

See [docs/idea.md](docs/idea.md) for the full product specification.

## Stack

- **Backend:** Node + TypeScript (tsx runtime), HTTP API in `backend/`.
- **Frontend:** Next.js 15+, React 19+, TypeScript (strict), Tailwind, App Router in `web/`.
- **Database:** PostgreSQL.
- **Package manager:** pnpm.

## Local Development

Prerequisites: Node 20+, pnpm, and a PostgreSQL instance (or run `docker compose up db`).

### Backend

```bash
cd backend
pnpm install
pnpm run dev
```

The API listens on `PORT` (default `10000`).

### Frontend

```bash
cd web
pnpm install
pnpm run dev
```

The web app runs on `http://localhost:3000` and talks to the backend via `NEXT_PUBLIC_API_URL`.

### Full stack with Docker

```bash
docker compose up
```

This brings up Postgres, the backend API, and the Next.js web app together.

## Environment Variables

### Backend

| Variable | Description | Example |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment | `production` |
| `PORT` | Port the API listens on | `10000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/storage_tier_recovery_desk` |
| `FRONTEND_URL` | Allowed origin for CORS | `http://localhost:3000` |

### Frontend

| Variable | Description | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the backend API | `http://localhost:10000` |

## Access

All features are free for signed-in users. There are no paid tiers, usage caps, or gated capabilities. Once you sign in, the entire recovery workflow (account registry, ingestion, access-pattern enrichment, pricing book, recovery worksheet, and realized-savings tracking) is fully available. A built-in sample-data seeder lets you explore the whole workflow without connecting a real cloud account.

## Deployment

- `render.yaml` defines the Render web service for the backend API.
- `docker-compose.yml` brings the full stack up locally.

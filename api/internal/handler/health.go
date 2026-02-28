package handler

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/worker"
)

// HealthHandler serves the detailed health check endpoint.
type HealthHandler struct {
	pool        *pgxpool.Pool
	cache       *cache.Cache
	eventBuffer *clickhouse.EventBuffer
	chReader    *clickhouse.Reader
	workerMgr   *worker.Manager
	startedAt   time.Time
}

// NewHealthHandler creates a new HealthHandler.
func NewHealthHandler(
	pool *pgxpool.Pool,
	c *cache.Cache,
	eventBuffer *clickhouse.EventBuffer,
	chReader *clickhouse.Reader,
	workerMgr *worker.Manager,
) *HealthHandler {
	return &HealthHandler{
		pool:        pool,
		cache:       c,
		eventBuffer: eventBuffer,
		chReader:    chReader,
		workerMgr:   workerMgr,
		startedAt:   time.Now(),
	}
}

// ─── Response Types ─────────────────────────────────────────────────────────

// ComponentStatus represents the health of a single infrastructure component.
type ComponentStatus struct {
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	LatencyMs float64 `json:"latency_ms,omitempty"`
	Message   string  `json:"message,omitempty"`
}

// WorkerStatus represents inferred status of a background worker.
type WorkerStatus struct {
	Name         string  `json:"name"`
	Status       string  `json:"status"`
	LastActivity *string `json:"last_activity,omitempty"`
	Details      string  `json:"details,omitempty"`
}

// ServiceInfo holds service-level metadata.
type ServiceInfo struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Details string `json:"details,omitempty"`
}

// HealthResponse is the full JSON response.
type HealthResponse struct {
	Status         string            `json:"status"`
	Timestamp      string            `json:"timestamp"`
	UptimeSeconds  int64             `json:"uptime_seconds"`
	Infrastructure []ComponentStatus `json:"infrastructure"`
	Workers        []WorkerStatus    `json:"workers"`
	Services       []ServiceInfo     `json:"services"`
}

// ─── Handler ────────────────────────────────────────────────────────────────

// GetHealth handles GET /api/v1/admin/health.
func (h *HealthHandler) GetHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	infra := h.checkInfrastructure(ctx)
	workers := h.checkWorkers(ctx)
	services := h.checkServices()

	// Determine overall status.
	overall := "healthy"
	for _, c := range infra {
		if c.Status == "unhealthy" {
			overall = "unhealthy"
			break
		}
	}
	if overall == "healthy" {
		for _, w := range workers {
			if w.Status == "offline" {
				overall = "degraded"
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, HealthResponse{
		Status:         overall,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		UptimeSeconds:  int64(time.Since(h.startedAt).Seconds()),
		Infrastructure: infra,
		Workers:        workers,
		Services:       services,
	})
}

// ─── Infrastructure Checks ──────────────────────────────────────────────────

func (h *HealthHandler) checkInfrastructure(ctx context.Context) []ComponentStatus {
	type pingResult struct {
		name    string
		err     error
		latency time.Duration
	}

	checks := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"postgresql", h.pool.Ping},
		{"redis", h.cache.Ping},
		{"clickhouse", h.chReader.Ping},
	}

	results := make(chan pingResult, len(checks))
	for _, check := range checks {
		go func(name string, fn func(context.Context) error) {
			start := time.Now()
			err := fn(ctx)
			results <- pingResult{name: name, err: err, latency: time.Since(start)}
		}(check.name, check.fn)
	}

	infra := make([]ComponentStatus, 0, len(checks))
	for i := 0; i < len(checks); i++ {
		r := <-results
		cs := ComponentStatus{
			Name:      r.name,
			Status:    "healthy",
			LatencyMs: float64(r.latency.Microseconds()) / 1000.0,
		}
		if r.err != nil {
			cs.Status = "unhealthy"
			cs.Message = r.err.Error()
		}
		infra = append(infra, cs)
	}

	return infra
}

// ─── Worker Checks ──────────────────────────────────────────────────────────

func (h *HealthHandler) checkWorkers(ctx context.Context) []WorkerStatus {
	workers := make([]WorkerStatus, 0, 2)

	// Parser worker: use process manager + parse_queue activity.
	parser := WorkerStatus{Name: "parser", Status: "offline"}
	processRunning := h.workerMgr.IsRunning()

	var jobsRunning int64
	var lastFinished *time.Time
	err := h.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'running'),
			MAX(finished_at)
		FROM parse_queue
	`).Scan(&jobsRunning, &lastFinished)

	if processRunning {
		if err == nil && jobsRunning > 0 {
			parser.Status = "active"
			parser.Details = fmt.Sprintf("process running, %d jobs processing", jobsRunning)
		} else {
			parser.Status = "idle"
			parser.Details = "process running, waiting for jobs"
		}
	} else {
		parser.Status = "offline"
		parser.Details = "process not running"
	}

	if err == nil && lastFinished != nil {
		ts := lastFinished.UTC().Format(time.RFC3339)
		parser.LastActivity = &ts
	}
	workers = append(workers, parser)

	// Categorizer: infer from latest ai_processed_at.
	categorizer := WorkerStatus{Name: "categorizer", Status: "unknown"}
	var lastProcessed *time.Time
	err = h.pool.QueryRow(ctx, `
		SELECT MAX(ai_processed_at) FROM videos WHERE ai_processed_at IS NOT NULL
	`).Scan(&lastProcessed)
	if err == nil {
		if lastProcessed != nil {
			ago := time.Since(*lastProcessed)
			ts := lastProcessed.UTC().Format(time.RFC3339)
			categorizer.LastActivity = &ts
			if ago < 15*time.Minute {
				categorizer.Status = "active"
				categorizer.Details = "recently processed videos"
			} else if ago < 30*time.Minute {
				categorizer.Status = "idle"
				categorizer.Details = fmt.Sprintf("last run %s ago", ago.Truncate(time.Second))
			} else {
				categorizer.Status = "offline"
				categorizer.Details = fmt.Sprintf("last run %s ago", ago.Truncate(time.Second))
			}
		} else {
			categorizer.Status = "unknown"
			categorizer.Details = "no categorized videos found"
		}
	}
	workers = append(workers, categorizer)

	return workers
}

// ─── Service Checks ─────────────────────────────────────────────────────────

func (h *HealthHandler) checkServices() []ServiceInfo {
	return []ServiceInfo{
		{
			Name:    "go_api",
			Status:  "healthy",
			Details: fmt.Sprintf("uptime %s, goroutines: %d", time.Since(h.startedAt).Truncate(time.Second), runtime.NumGoroutine()),
		},
		{
			Name:    "event_buffer",
			Status:  "healthy",
			Details: fmt.Sprintf("buffered: %d/%d", h.eventBuffer.BufferLen(), h.eventBuffer.MaxSize()),
		},
	}
}

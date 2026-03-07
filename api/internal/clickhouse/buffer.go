package clickhouse

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/xcj/videosite-api/internal/model"
)

// EventBuffer accumulates analytics events in memory and flushes them
// to ClickHouse in batches. It flushes either when the buffer reaches
// maxSize or every flushInterval, whichever comes first.
type EventBuffer struct {
	conn          driver.Conn
	mu            sync.Mutex
	buffer        []model.Event
	maxSize       int
	flushInterval time.Duration
	done          chan struct{}
	wg            sync.WaitGroup
}

// NewEventBuffer creates a new event buffer connected to ClickHouse.
func NewEventBuffer(clickhouseURL string, maxSize int, flushInterval time.Duration) (*EventBuffer, error) {
	opts, err := clickhouse.ParseDSN(clickhouseURL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: parse dsn: %w", err)
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: open: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("clickhouse: ping: %w", err)
	}

	eb := &EventBuffer{
		conn:          conn,
		buffer:        make([]model.Event, 0, maxSize),
		maxSize:       maxSize,
		flushInterval: flushInterval,
		done:          make(chan struct{}),
	}

	eb.wg.Add(1)
	go eb.flushLoop()

	return eb, nil
}

// Ping checks the ClickHouse connection.
func (eb *EventBuffer) Ping(ctx context.Context) error {
	return eb.conn.Ping(ctx)
}

// BufferLen returns the number of events currently buffered.
func (eb *EventBuffer) BufferLen() int {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	return len(eb.buffer)
}

// MaxSize returns the configured max buffer size.
func (eb *EventBuffer) MaxSize() int {
	return eb.maxSize
}

// Push adds an event to the buffer. If the buffer reaches maxSize, a flush
// is triggered immediately.
func (eb *EventBuffer) Push(event model.Event) {
	eb.mu.Lock()
	eb.buffer = append(eb.buffer, event)
	shouldFlush := len(eb.buffer) >= eb.maxSize
	eb.mu.Unlock()

	if shouldFlush {
		go eb.flush()
	}
}

// Close stops the background flush loop and performs a final flush.
func (eb *EventBuffer) Close() error {
	close(eb.done)
	eb.wg.Wait()
	eb.flush()
	return eb.conn.Close()
}

func (eb *EventBuffer) flushLoop() {
	defer eb.wg.Done()
	ticker := time.NewTicker(eb.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			eb.flush()
		case <-eb.done:
			return
		}
	}
}

func (eb *EventBuffer) flush() {
	eb.mu.Lock()
	if len(eb.buffer) == 0 {
		eb.mu.Unlock()
		return
	}
	events := eb.buffer
	eb.buffer = make([]model.Event, 0, eb.maxSize)
	eb.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	batch, err := eb.conn.PrepareBatch(ctx, `
		INSERT INTO events (
			site_id, video_id, event_type, session_id,
			user_agent, ip, referrer, extra, created_at,
			account_id, target_url, source_page, source,
			browser, os, device_type,
			screen_width, screen_height, viewport_width, viewport_height,
			language, connection_type, page_url, country,
			utm_source, utm_medium, utm_campaign
		)
	`)
	if err != nil {
		slog.Error("clickhouse: prepare batch", "error", err, "events_lost", len(events))
		return
	}

	for _, e := range events {
		if err := batch.Append(
			e.SiteID,
			e.VideoID,
			e.Type,
			e.SessionID,
			e.UserAgent,
			e.IP,
			e.Referrer,
			e.Extra,
			e.CreatedAt,
			e.AccountID,
			e.TargetURL,
			e.SourcePage,
			e.Source,
			e.Browser,
			e.OS,
			e.DeviceType,
			int16(e.ScreenWidth),
			int16(e.ScreenHeight),
			int16(e.ViewportWidth),
			int16(e.ViewportHeight),
			e.Language,
			e.ConnectionType,
			e.PageURL,
			e.Country,
			e.UTMSource,
			e.UTMMedium,
			e.UTMCampaign,
		); err != nil {
			slog.Error("clickhouse: append event", "error", err)
			continue
		}
	}

	if err := batch.Send(); err != nil {
		slog.Error("clickhouse: send batch", "error", err, "events_lost", len(events))
		return
	}

	slog.Info("clickhouse: flushed events", "count", len(events))
}

// InsertPerfEvent writes a single banner performance event to ClickHouse.
func (eb *EventBuffer) InsertPerfEvent(ctx context.Context, p *model.PerfEvent) {
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	isViewable := uint8(0)
	if p.IsViewable {
		isViewable = 1
	}

	err := eb.conn.Exec(ctx2, `
		INSERT INTO banner_perf (
			banner_id, video_id, account_id, site_id,
			image_load_ms, render_ms, time_to_visible_ms, dwell_time_ms, hover_duration_ms,
			is_viewable, browser, os, device_type,
			screen_width, screen_height, connection_type, country
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.BannerID, p.VideoID, p.AccountID, p.SiteID,
		int16(p.ImageLoadMs), int16(p.RenderMs), uint32(p.TimeToVisibleMs), uint32(p.DwellTimeMs), int16(p.HoverDurationMs),
		isViewable, p.Browser, p.OS, p.DeviceType,
		int16(p.ScreenWidth), int16(p.ScreenHeight), p.ConnectionType, p.Country,
	)
	if err != nil {
		slog.Error("clickhouse: insert perf event", "error", err, "banner_id", p.BannerID)
	}
}

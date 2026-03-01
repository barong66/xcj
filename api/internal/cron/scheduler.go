package cron

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type Job struct {
	Name     string
	Interval time.Duration
	Fn       func(ctx context.Context) error
}

type Scheduler struct {
	jobs []Job
	wg   sync.WaitGroup
	done chan struct{}
}

func NewScheduler() *Scheduler {
	return &Scheduler{
		done: make(chan struct{}),
	}
}

func (s *Scheduler) Add(job Job) {
	s.jobs = append(s.jobs, job)
}

func (s *Scheduler) Start() {
	for _, job := range s.jobs {
		s.wg.Add(1)
		go s.run(job)
	}
}

func (s *Scheduler) run(job Job) {
	defer s.wg.Done()

	slog.Info("cron: starting job", "name", job.Name, "interval", job.Interval)

	// Run immediately on start.
	if err := job.Fn(context.Background()); err != nil {
		slog.Error("cron: job failed", "name", job.Name, "error", err)
	}

	ticker := time.NewTicker(job.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := job.Fn(context.Background()); err != nil {
				slog.Error("cron: job failed", "name", job.Name, "error", err)
			}
		case <-s.done:
			return
		}
	}
}

func (s *Scheduler) Stop() {
	close(s.done)
	s.wg.Wait()
	slog.Info("cron: all jobs stopped")
}

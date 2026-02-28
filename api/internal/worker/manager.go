package worker

import (
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
)

// Manager manages the Python parser worker subprocess lifecycle.
type Manager struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	running bool
	dir     string // project root directory (where parser/ lives)
}

// New creates a worker manager. dir is the project root containing the parser/ package.
func New(dir string) *Manager {
	return &Manager{dir: dir}
}

// EnsureRunning starts the parser worker if it's not already running.
func (m *Manager) EnsureRunning() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return
	}

	cmd := exec.Command("python", "-m", "parser", "worker")
	cmd.Dir = m.dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		slog.Error("failed to start parser worker", "error", err)
		return
	}

	m.cmd = cmd
	m.running = true
	slog.Info("parser worker started", "pid", cmd.Process.Pid)

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		m.running = false
		m.cmd = nil
		m.mu.Unlock()

		if err != nil {
			slog.Warn("parser worker exited with error", "error", err)
		} else {
			slog.Info("parser worker exited")
		}
	}()
}

// Stop sends SIGTERM to the worker for graceful shutdown.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running || m.cmd == nil || m.cmd.Process == nil {
		return
	}

	slog.Info("stopping parser worker", "pid", m.cmd.Process.Pid)
	if err := m.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		slog.Error("failed to send SIGTERM to parser worker", "error", err)
	}
}

// IsRunning returns whether the worker process is currently alive.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

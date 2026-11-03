package sysinfo

import (
	"os"
	"runtime"
	"time"
)

var startTime = time.Now()

// Collect gathers local host system telemetry across CPU, RAM, Disk, and Uptime.
func Collect(version string) SystemMetrics {
	hostname, _ := os.Hostname()

	m := SystemMetrics{
		Hostname:    hostname,
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		NumCPU:      runtime.NumCPU(),
		UptimeSec:   int64(time.Since(startTime).Seconds()),
		CollectedAt: time.Now().UTC(),
		Version:     version,
		Disks:       make([]DiskInfo, 0),
	}

	collectPlatformMetrics(&m)

	// Ensure Disks is not nil for JSON consistency
	if m.Disks == nil {
		m.Disks = make([]DiskInfo, 0)
	}

	return m
}

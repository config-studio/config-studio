package agent

import (
	"time"

	"config-studio/internal/sysinfo"
)

var agentStartTime = time.Now()

// SystemMetrics is an alias to the unified sysinfo.SystemMetrics.
type SystemMetrics = sysinfo.SystemMetrics

// MemoryInfo is an alias to the unified sysinfo.MemoryInfo.
type MemoryInfo = sysinfo.MemoryInfo

// DiskInfo is an alias to the unified sysinfo.DiskInfo.
type DiskInfo = sysinfo.DiskInfo

// CollectSystemMetrics gathers OS & hardware telemetry using the unified sysinfo engine.
func CollectSystemMetrics(version string) SystemMetrics {
	return sysinfo.Collect(version)
}

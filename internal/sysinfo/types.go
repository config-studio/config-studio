package sysinfo

import (
	"fmt"
	"strings"
	"time"
)

// SystemMetrics represents a complete snapshot of hardware and OS telemetry.
type SystemMetrics struct {
	Hostname    string     `json:"hostname"`
	OS          string     `json:"os"`
	Arch        string     `json:"arch"`
	NumCPU      int        `json:"numCpu"`
	CPUPercent  float64    `json:"cpuPercent"`
	UptimeSec   int64      `json:"uptimeSec"`
	LoadAvg     [3]float64 `json:"loadAvg"`
	Memory      MemoryInfo `json:"memory"`
	Disks       []DiskInfo `json:"disks"`
	CollectedAt time.Time  `json:"collectedAt"`
	Version     string     `json:"version"`
}

// MemoryInfo contains RAM metrics in bytes and percentage.
type MemoryInfo struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
}

// DiskInfo contains mount point disk usage metrics in bytes and percentage.
type DiskInfo struct {
	MountPoint     string  `json:"mountPoint"`
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
}

// ToPrometheusFormat formats metrics into Prometheus OpenMetrics exposition format.
func (m *SystemMetrics) ToPrometheusFormat() string {
	var b strings.Builder
	b.WriteString("# HELP cs_agent_uptime_seconds Daemon uptime in seconds\n")
	b.WriteString("# TYPE cs_agent_uptime_seconds counter\n")
	b.WriteString(fmt.Sprintf("cs_agent_uptime_seconds{hostname=%q} %d\n\n", m.Hostname, m.UptimeSec))

	b.WriteString("# HELP cs_agent_cpu_cores Number of CPU cores\n")
	b.WriteString("# TYPE cs_agent_cpu_cores gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_cpu_cores{hostname=%q} %d\n\n", m.Hostname, m.NumCPU))

	b.WriteString("# HELP cs_agent_cpu_percent Total CPU utilization percentage\n")
	b.WriteString("# TYPE cs_agent_cpu_percent gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_cpu_percent{hostname=%q} %.2f\n\n", m.Hostname, m.CPUPercent))

	b.WriteString("# HELP cs_agent_load1 1-minute load average\n")
	b.WriteString("# TYPE cs_agent_load1 gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_load1{hostname=%q} %.2f\n\n", m.Hostname, m.LoadAvg[0]))

	b.WriteString("# HELP cs_agent_memory_total_bytes Total system memory\n")
	b.WriteString("# TYPE cs_agent_memory_total_bytes gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_memory_total_bytes{hostname=%q} %d\n\n", m.Hostname, m.Memory.TotalBytes))

	b.WriteString("# HELP cs_agent_memory_used_bytes Used system memory\n")
	b.WriteString("# TYPE cs_agent_memory_used_bytes gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_memory_used_bytes{hostname=%q} %d\n\n", m.Hostname, m.Memory.UsedBytes))

	b.WriteString("# HELP cs_agent_memory_used_percent Used system memory percentage\n")
	b.WriteString("# TYPE cs_agent_memory_used_percent gauge\n")
	b.WriteString(fmt.Sprintf("cs_agent_memory_used_percent{hostname=%q} %.2f\n\n", m.Hostname, m.Memory.UsedPercent))

	for _, d := range m.Disks {
		b.WriteString(fmt.Sprintf("cs_agent_disk_used_percent{hostname=%q,mount=%q} %.2f\n", m.Hostname, d.MountPoint, d.UsedPercent))
		b.WriteString(fmt.Sprintf("cs_agent_disk_available_bytes{hostname=%q,mount=%q} %d\n", m.Hostname, d.MountPoint, d.AvailableBytes))
	}

	return b.String()
}

//go:build linux

package sysinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

var (
	cpuLinuxMutex sync.Mutex
	lastIdleLinux uint64
	lastTotalLinux uint64
	lastLinuxCPU   float64
)

func collectPlatformMetrics(m *SystemMetrics) {
	readLinuxUptime(m)
	readLinuxLoadAvg(m)
	readLinuxMemInfo(m)
	readLinuxCPU(m)
	collectLinuxDisks(m)
}

func readLinuxUptime(m *SystemMetrics) {
	data, err := os.ReadFile("/proc/uptime")
	if err == nil {
		parts := strings.Fields(string(data))
		if len(parts) > 0 {
			if sec, err := strconv.ParseFloat(parts[0], 64); err == nil {
				m.UptimeSec = int64(sec)
			}
		}
	}
}

func readLinuxLoadAvg(m *SystemMetrics) {
	data, err := os.ReadFile("/proc/loadavg")
	if err == nil {
		parts := strings.Fields(string(data))
		if len(parts) >= 3 {
			l1, _ := strconv.ParseFloat(parts[0], 64)
			l5, _ := strconv.ParseFloat(parts[1], 64)
			l15, _ := strconv.ParseFloat(parts[2], 64)
			m.LoadAvg = [3]float64{l1, l5, l15}
		}
	}
}

func readLinuxMemInfo(m *SystemMetrics) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer file.Close()

	var total, free, available, buffers, cached uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(parts[1], 10, 64)
		valBytes := val * 1024

		switch strings.TrimSuffix(parts[0], ":") {
		case "MemTotal":
			total = valBytes
		case "MemFree":
			free = valBytes
		case "MemAvailable":
			available = valBytes
		case "Buffers":
			buffers = valBytes
		case "Cached":
			cached = valBytes
		}
	}

	if available == 0 {
		available = free + buffers + cached
	}
	used := total - available
	var usedPct float64
	if total > 0 {
		usedPct = (float64(used) / float64(total)) * 100.0
	}

	m.Memory = MemoryInfo{
		TotalBytes:     total,
		AvailableBytes: available,
		UsedBytes:      used,
		UsedPercent:    usedPct,
	}
}

func readLinuxCPU(m *SystemMetrics) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		// Fallback to load1 / numCpu
		if m.NumCPU > 0 {
			m.CPUPercent = (m.LoadAvg[0] / float64(m.NumCPU)) * 100.0
			if m.CPUPercent > 100.0 {
				m.CPUPercent = 100.0
			}
		}
		return
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) >= 5 {
				var total uint64
				for i := 1; i < len(fields); i++ {
					val, _ := strconv.ParseUint(fields[i], 10, 64)
					total += val
				}
				idle, _ := strconv.ParseUint(fields[4], 10, 64)
				if len(fields) >= 6 {
					iowait, _ := strconv.ParseUint(fields[5], 10, 64)
					idle += iowait
				}

				cpuLinuxMutex.Lock()
				if lastTotalLinux > 0 && total > lastTotalLinux {
					deltaTotal := total - lastTotalLinux
					deltaIdle := idle - lastIdleLinux
					if deltaTotal >= deltaIdle {
						busy := deltaTotal - deltaIdle
						pct := (float64(busy) / float64(deltaTotal)) * 100.0
						if pct > 100.0 {
							pct = 100.0
						}
						lastLinuxCPU = pct
					}
				} else if m.NumCPU > 0 {
					lastLinuxCPU = (m.LoadAvg[0] / float64(m.NumCPU)) * 100.0
				}
				lastTotalLinux = total
				lastIdleLinux = idle
				m.CPUPercent = lastLinuxCPU
				cpuLinuxMutex.Unlock()
				return
			}
		}
	}
}

func collectLinuxDisks(m *SystemMetrics) {
	mounts := []string{"/"}
	for _, mount := range mounts {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mount, &stat); err == nil && stat.Blocks > 0 {
			total := stat.Blocks * uint64(stat.Bsize)
			free := stat.Bfree * uint64(stat.Bsize)
			avail := stat.Bavail * uint64(stat.Bsize)
			used := total - free
			usedPct := (float64(used) / float64(total)) * 100.0

			m.Disks = append(m.Disks, DiskInfo{
				MountPoint:     mount,
				TotalBytes:     total,
				AvailableBytes: avail,
				UsedBytes:      used,
				UsedPercent:    usedPct,
			})
		}
	}
}

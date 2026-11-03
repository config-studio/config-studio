//go:build !windows && !linux

package sysinfo

import (
	"runtime"
	"syscall"
)

func collectPlatformMetrics(m *SystemMetrics) {
	var rMem runtime.MemStats
	runtime.ReadMemStats(&rMem)
	m.Memory = MemoryInfo{
		TotalBytes:     rMem.Sys,
		AvailableBytes: rMem.Sys - rMem.Alloc,
		UsedBytes:      rMem.Alloc,
		UsedPercent:    float64(rMem.Alloc) / float64(rMem.Sys) * 100.0,
	}

	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil && stat.Blocks > 0 {
		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bfree * uint64(stat.Bsize)
		avail := stat.Bavail * uint64(stat.Bsize)
		used := total - free
		usedPct := (float64(used) / float64(total)) * 100.0

		m.Disks = append(m.Disks, DiskInfo{
			MountPoint:     "/",
			TotalBytes:     total,
			AvailableBytes: avail,
			UsedBytes:      used,
			UsedPercent:    usedPct,
		})
	}
}

//go:build windows

package sysinfo

import (
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32Dll             = syscall.NewLazyDLL("kernel32.dll")
	globalMemoryStatusEx    = kernel32Dll.NewProc("GlobalMemoryStatusEx")
	getDiskFreeSpaceExW     = kernel32Dll.NewProc("GetDiskFreeSpaceExW")
	getSystemTimes          = kernel32Dll.NewProc("GetSystemTimes")
	getTickCount64          = kernel32Dll.NewProc("GetTickCount64")
	getLogicalDriveStringsW = kernel32Dll.NewProc("GetLogicalDriveStringsW")

	cpuMutex     sync.Mutex
	lastIdle     uint64
	lastKernel   uint64
	lastUser     uint64
	lastCPUTime  time.Time
	lastCPUValue float64
)

type memoryStatusEx struct {
	cbSize                  uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

func fileTimeToUint64(ft syscall.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}

func collectPlatformMetrics(m *SystemMetrics) {
	// 1. System Uptime via GetTickCount64 (actual OS uptime)
	if getTickCount64.Find() == nil {
		r, _, _ := getTickCount64.Call()
		if r > 0 {
			m.UptimeSec = int64(r / 1000)
		}
	}

	// 2. Physical RAM via GlobalMemoryStatusEx
	var memEx memoryStatusEx
	memEx.cbSize = uint32(unsafe.Sizeof(memEx))
	r1, _, _ := globalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memEx)))
	if r1 != 0 && memEx.ullTotalPhys > 0 {
		used := memEx.ullTotalPhys - memEx.ullAvailPhys
		usedPct := (float64(used) / float64(memEx.ullTotalPhys)) * 100.0
		m.Memory = MemoryInfo{
			TotalBytes:     memEx.ullTotalPhys,
			AvailableBytes: memEx.ullAvailPhys,
			UsedBytes:      used,
			UsedPercent:    usedPct,
		}
	}

	// 3. CPU Load via GetSystemTimes
	collectWindowsCPU(m)

	// 4. Disk Free Space across available drives
	collectWindowsDisks(m)
}

func collectWindowsCPU(m *SystemMetrics) {
	var idleTime, kernelTime, userTime syscall.Filetime
	r, _, _ := getSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if r == 0 {
		return
	}

	idle := fileTimeToUint64(idleTime)
	kern := fileTimeToUint64(kernelTime)
	user := fileTimeToUint64(userTime)

	cpuMutex.Lock()
	defer cpuMutex.Unlock()

	now := time.Now()
	if lastCPUTime.IsZero() {
		lastIdle = idle
		lastKernel = kern
		lastUser = user
		lastCPUTime = now
		m.CPUPercent = 0.0
		return
	}

	deltaIdle := idle - lastIdle
	deltaKern := kern - lastKernel
	deltaUser := user - lastUser
	total := deltaKern + deltaUser

	if total > 0 && deltaIdle <= total {
		busy := total - deltaIdle
		pct := (float64(busy) / float64(total)) * 100.0
		if pct > 100.0 {
			pct = 100.0
		} else if pct < 0.0 {
			pct = 0.0
		}
		lastCPUValue = pct
	}

	lastIdle = idle
	lastKernel = kern
	lastUser = user
	lastCPUTime = now

	m.CPUPercent = lastCPUValue
	// Synthetic 1m load avg representation based on CPU% and cores
	cores := float64(m.NumCPU)
	load1 := (m.CPUPercent / 100.0) * cores
	m.LoadAvg = [3]float64{load1, load1, load1}
}

func collectWindowsDisks(m *SystemMetrics) {
	drives := getLogicalDrives()
	if len(drives) == 0 {
		drives = []string{"C:\\"}
	}

	for _, drive := range drives {
		drivePtr, err := syscall.UTF16PtrFromString(drive)
		if err != nil {
			continue
		}

		var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
		r, _, _ := getDiskFreeSpaceExW.Call(
			uintptr(unsafe.Pointer(drivePtr)),
			uintptr(unsafe.Pointer(&freeBytesAvailable)),
			uintptr(unsafe.Pointer(&totalNumberOfBytes)),
			uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
		)

		if r != 0 && totalNumberOfBytes > 0 {
			used := totalNumberOfBytes - totalNumberOfFreeBytes
			usedPct := (float64(used) / float64(totalNumberOfBytes)) * 100.0
			m.Disks = append(m.Disks, DiskInfo{
				MountPoint:     drive,
				TotalBytes:     totalNumberOfBytes,
				AvailableBytes: freeBytesAvailable,
				UsedBytes:      used,
				UsedPercent:    usedPct,
			})
		}
	}
}

func getLogicalDrives() []string {
	var buf [512]uint16
	r, _, _ := getLogicalDriveStringsW.Call(uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])))
	if r == 0 || r > uintptr(len(buf)) {
		return []string{"C:\\"}
	}

	var drives []string
	start := 0
	for i := 0; i < int(r); i++ {
		if buf[i] == 0 {
			if i > start {
				drives = append(drives, syscall.UTF16ToString(buf[start:i]))
			}
			start = i + 1
		}
	}
	return drives
}

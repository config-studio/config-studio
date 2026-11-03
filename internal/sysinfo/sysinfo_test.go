package sysinfo

import (
	"testing"
)

func TestCollect(t *testing.T) {
	m := Collect("2.1.0-test")

	if m.Hostname == "" {
		t.Errorf("expected non-empty hostname")
	}
	if m.OS == "" {
		t.Errorf("expected non-empty OS")
	}
	if m.NumCPU <= 0 {
		t.Errorf("expected NumCPU > 0, got %d", m.NumCPU)
	}
	if m.Memory.TotalBytes == 0 {
		t.Errorf("expected non-zero Memory.TotalBytes")
	}
	if len(m.Disks) == 0 {
		t.Logf("warning: no disks detected")
	} else {
		d := m.Disks[0]
		if d.TotalBytes == 0 {
			t.Errorf("expected non-zero disk TotalBytes for mount %s", d.MountPoint)
		}
	}

	prom := m.ToPrometheusFormat()
	if len(prom) == 0 {
		t.Errorf("expected non-empty prometheus format")
	}
}

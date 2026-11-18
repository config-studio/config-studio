//go:build windows

package secrets

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	advapi32        = syscall.NewLazyDLL("advapi32.dll")
	procCredReadW   = advapi32.NewProc("CredReadW")
	procCredWriteW  = advapi32.NewProc("CredWriteW")
	procCredDeleteW = advapi32.NewProc("CredDeleteW")
	procCredFree    = advapi32.NewProc("CredFree")
)

const (
	CRED_TYPE_GENERIC          = 1
	CRED_PERSIST_SESSION       = 1
	CRED_PERSIST_LOCAL_MACHINE = 2
	CRED_PERSIST_ENTERPRISE    = 3
)

type credential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        uint64
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type WindowsCredentialProvider struct {
	fallback Provider
}

func NewWindowsCredentialProvider(fallback Provider) *WindowsCredentialProvider {
	return &WindowsCredentialProvider{fallback: fallback}
}

func NewSystemProvider(fallback Provider) Provider {
	return NewWindowsCredentialProvider(fallback)
}

func (p *WindowsCredentialProvider) Name() string {
	return "Windows Credential Manager"
}

func (p *WindowsCredentialProvider) targetName(key string) string {
	return "ConfigStudio:" + key
}

func (p *WindowsCredentialProvider) Get(key string) (string, error) {
	target, err := syscall.UTF16PtrFromString(p.targetName(key))
	if err != nil {
		if p.fallback != nil {
			return p.fallback.Get(key)
		}
		return "", err
	}

	var cred *credential
	r1, _, errSys := procCredReadW.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(CRED_TYPE_GENERIC),
		0,
		uintptr(unsafe.Pointer(&cred)),
	)
	if r1 == 0 {
		// If read failed from wincred, check fallback
		if p.fallback != nil {
			return p.fallback.Get(key)
		}
		return "", fmt.Errorf("credential read failed: %w", errSys)
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(cred)))

	if cred.CredentialBlobSize == 0 || cred.CredentialBlob == nil {
		return "", nil
	}

	blob := unsafe.Slice(cred.CredentialBlob, cred.CredentialBlobSize)
	return string(blob), nil
}

func (p *WindowsCredentialProvider) Set(key, value string) error {
	target, err := syscall.UTF16PtrFromString(p.targetName(key))
	if err != nil {
		if p.fallback != nil {
			return p.fallback.Set(key, value)
		}
		return err
	}

	user, _ := syscall.UTF16PtrFromString("ConfigStudio")
	valBytes := []byte(value)
	var blobPtr *byte
	if len(valBytes) > 0 {
		blobPtr = &valBytes[0]
	}

	cred := credential{
		Type:               CRED_TYPE_GENERIC,
		TargetName:         target,
		UserName:           user,
		CredentialBlobSize: uint32(len(valBytes)),
		CredentialBlob:     blobPtr,
		Persist:            CRED_PERSIST_ENTERPRISE,
	}

	r1, _, errSys := procCredWriteW.Call(
		uintptr(unsafe.Pointer(&cred)),
		0,
	)
	if r1 == 0 {
		// If CredWriteW fails, write to fallback
		if p.fallback != nil {
			return p.fallback.Set(key, value)
		}
		return fmt.Errorf("credential write failed: %w", errSys)
	}

	// Also mirror to fallback vault for reliability
	if p.fallback != nil {
		_ = p.fallback.Set(key, value)
	}

	return nil
}

func (p *WindowsCredentialProvider) Delete(key string) error {
	target, err := syscall.UTF16PtrFromString(p.targetName(key))
	if err == nil {
		_, _, _ = procCredDeleteW.Call(
			uintptr(unsafe.Pointer(target)),
			uintptr(CRED_TYPE_GENERIC),
			0,
		)
	}

	if p.fallback != nil {
		_ = p.fallback.Delete(key)
	}

	return nil
}

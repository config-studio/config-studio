package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"strings"

	gossh "golang.org/x/crypto/ssh"
)

// KeyPair holds generated private and public keys.
type KeyPair struct {
	Type          string `json:"type"`
	PrivateKeyPEM string `json:"privateKeyPEM"`
	PrivateKey    string `json:"privateKey"`
	PublicKeyAuth string `json:"publicKeyAuth"`
	PublicKey     string `json:"publicKey"`
	Fingerprint   string `json:"fingerprint"`
	Comment       string `json:"comment"`
}

// GenerateEd25519KeyPair generates a brand new Ed25519 SSH keypair.
func GenerateEd25519KeyPair(comment string) (*KeyPair, error) {
	if comment == "" {
		comment = "config-studio-key"
	}

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ed25519 key: %w", err)
	}

	// 1. Marshal private key to OpenSSH PEM block
	pemBlock, err := gossh.MarshalPrivateKey(privKey, comment)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal private key: %w", err)
	}
	privPEM := string(pem.EncodeToMemory(pemBlock))

	// 2. Marshal public key to authorized_keys format
	sshPubKey, err := gossh.NewPublicKey(pubKey)
	if err != nil {
		return nil, fmt.Errorf("failed to format public key: %w", err)
	}
	pubAuth := strings.TrimSpace(string(gossh.MarshalAuthorizedKey(sshPubKey)))
	if !strings.HasSuffix(pubAuth, comment) {
		pubAuth = pubAuth + " " + comment
	}
	fp := gossh.FingerprintSHA256(sshPubKey)

	return &KeyPair{
		Type:          "ed25519",
		PrivateKeyPEM: privPEM,
		PrivateKey:    privPEM,
		PublicKeyAuth: pubAuth,
		PublicKey:     pubAuth,
		Fingerprint:   fp,
		Comment:       comment,
	}, nil
}
